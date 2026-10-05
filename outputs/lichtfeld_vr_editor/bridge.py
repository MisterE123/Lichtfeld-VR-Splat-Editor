# SPDX-License-Identifier: GPL-3.0-or-later
"""Loopback transport with queued UI-thread work and topology guards."""
import json
import os
import queue
import secrets
import tempfile
import threading
import time
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import numpy as np
import lichtfeld as lf

def array(t):
    return np.asarray(t.cpu().numpy())

def tensor(a):
    return lf.Tensor.from_numpy(np.ascontiguousarray(a)).cuda()

def write_ply(data, path):
    """Keep all rows, including deleted ones, so native indices never drift."""
    n = data.num_points
    cols = {}
    for names, values in [(["x", "y", "z"], array(data.means_raw)),
                          (["f_dc_0", "f_dc_1", "f_dc_2"], array(data.sh0_raw).reshape(n, 3)),
                          (["scale_0", "scale_1", "scale_2"], array(data.scaling_raw)),
                          (["rot_0", "rot_1", "rot_2", "rot_3"], array(data.rotation_raw))]:
        for i, name in enumerate(names):
            cols[name] = values[:, i]
    sh = array(data.shN_raw)
    if sh.size:
        sh = sh.transpose(0, 2, 1).reshape(n, -1)
        for i in range(sh.shape[1]):
            cols[f"f_rest_{i}"] = sh[:, i]
    cols["opacity"] = array(data.opacity_raw).reshape(n)
    records = np.empty(n, dtype=[(k, "<f4") for k in cols])
    for k, v in cols.items():
        records[k] = v
    header = "ply\nformat binary_little_endian 1.0\n" + f"element vertex {n}\n"
    header += "".join(f"property float {k}\n" for k in cols) + "end_header\n"
    with open(path, "wb") as f:
        f.write(header.encode("ascii"))
        f.write(records.tobytes())

class Bridge:
    def __init__(self, root):
        self.root = Path(root)
        self.server = None
        self.thread = None
        self.pending = queue.Queue(maxsize=16)
        self.status = "Ready. Load a splat scene, then launch the editor."
        self.stroke = False
        self.records = []
        self.token = ""
        self.temp = None
        self.scene = None
        self.last_client = 0
        self.mask = None
        self.watchdog_stop = threading.Event()
        self.watchdog = None
        self.diagnostics = []
        self.selection_mode = "center"

    def topology(self, scene):
        return [(n.uuid, n.gaussian_count) for n in scene.get_nodes()
                if n.type == lf.scene.NodeType.SPLAT]

    def guard(self):
        current = lf.get_scene()
        if current is None or self.topology(current) != self.signature:
            raise RuntimeError("Scene topology changed. Stop and relaunch VR Editor.")
        # Node matrices and visibility are part of the exported scene contract.
        if [n.uuid for n in current.get_visible_nodes() if n.type == lf.scene.NodeType.SPLAT] != self.visible_signature:
            raise RuntimeError("Scene visibility changed. Stop and relaunch VR Editor.")
        for r in self.records:
            node = current.get_node(r["name"])
            if node is None or node.uuid != r["uuid"] or not np.allclose(
                    np.asarray(node.world_transform).reshape(4, 4), r["matrix"]):
                raise RuntimeError("Scene transforms changed. Stop and relaunch VR Editor.")
        self.scene = current
        return current

    def start(self, open_browser=True):
        self.stop()
        scene = lf.get_scene()
        if scene is None:
            raise RuntimeError("Load a Gaussian splat scene first.")
        if lf.context().is_training:
            raise RuntimeError("Pause training before VR editing.")
        self.scene = scene
        self.signature = self.topology(scene)
        self.records = []
        self.temp = tempfile.TemporaryDirectory(prefix="lichtfeld-vr-editor-")
        self.token = secrets.token_urlsafe(32)
        self.stroke = False
        offset = 0
        manifest = []
        for node in scene.get_nodes():
            if node.type != lf.scene.NodeType.SPLAT:
                continue
            count = node.gaussian_count
            data = node.splat_data()
            if data is not None and scene.is_node_effectively_visible(node.id):
                filename = f"node-{len(self.records)}.ply"
                write_ply(data, Path(self.temp.name) / filename)
                matrix = np.asarray(node.world_transform, dtype=np.float32).reshape(4, 4)
                basis = matrix[:3, :3]
                norm = np.linalg.norm(basis, axis=0)
                if np.any(norm < 1e-6) or np.linalg.det(basis) <= 0 or not np.allclose(
                        (basis / norm).T @ (basis / norm), np.eye(3), atol=1e-4):
                    raise RuntimeError(f"Node '{node.name}' has a mirrored, singular, or sheared transform. Bake its transform before VR editing.")
                record = dict(name=node.name, uuid=node.uuid, offset=offset,
                              count=count, matrix=matrix, file=filename)
                self.records.append(record)
                manifest.append({k: (v.tolist() if isinstance(v, np.ndarray) else v)
                                 for k, v in record.items()})
            offset += count
        if not manifest:
            self.temp.cleanup()
            self.temp = None
            raise RuntimeError("No visible splat nodes available.")
        self.total = offset
        self.visible_signature = [n.uuid for n in scene.get_visible_nodes() if n.type == lf.scene.NodeType.SPLAT]
        self.selection_array()  # Verify native mask indexing before serving the viewer.
        self.allowed = np.zeros(offset, dtype=bool)
        for r in self.records:
            self.allowed[r["offset"]:r["offset"] + r["count"]] = True
        self.config = {"nodeName": "Lichtfeld Scene", "nodes": manifest,
                       "settings": {"camera": {"fov": 60, "startAnim": "none"},
                                    "background": {"color": [0.08, 0.08, 0.12]}, "animTracks": []}}
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, bridge=self,
                                         directory=str(self.root / "viewer")))
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.watchdog_stop = threading.Event()
        def watch():
            while not self.watchdog_stop.wait(.5):
                if self.stroke:
                    lf.ui.schedule_on_ui_thread(self.pump)
        self.watchdog = threading.Thread(target=watch, daemon=True)
        self.watchdog.start()
        self.last_client = time.monotonic()
        self.status = "VR Editor running. Click Enter VR in your browser."
        self.url = f"http://127.0.0.1:{self.server.server_port}/index.html#{self.token}"
        if open_browser:
            webbrowser.open(self.url)

    def finish_stroke(self, cancel=False):
        if self.stroke:
            if cancel:
                self.scene.cancel_selection_preview()
            else:
                self.scene.commit_selection_preview()
            self.stroke = False
            self.mask = None

    def stop(self):
        self.watchdog_stop.set()
        if self.watchdog:
            self.watchdog.join(timeout=1)
            self.watchdog = None
        self.finish_stroke(cancel=True)
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            self.server = None
        if self.thread:
            self.thread.join(timeout=2)
            self.thread = None
        while not self.pending.empty():
            item = self.pending.get_nowait()
            item[1]["error"] = "VR Editor stopped"
            item[2].set()
        if self.temp:
            self.temp.cleanup()
            self.temp = None
        self.status = "Stopped"

    def pump(self, *_):
        if not self.server:
            return
        if self.stroke and time.monotonic() - self.last_client > 3:
            self.finish_stroke(cancel=True)
        # Bound per-frame work; API requests never invoke native bindings on HTTP threads.
        for _ in range(2):
            try:
                command, result, event = self.pending.get_nowait()
            except queue.Empty:
                break
            if result.get("expired"):
                continue
            try:
                if lf.context().is_training:
                    raise RuntimeError("Pause training before VR editing.")
                self.guard()
                result["data"] = self.execute(command)
                self.last_client = time.monotonic()
            except Exception as exc:
                self.finish_stroke(cancel=True)
                result["error"] = str(exc)
                self.status = f"VR Editor: {exc}"
            finally:
                event.set()

    def selection_array(self):
        mask = self.scene.selection_mask
        if mask is None:
            return np.zeros(self.total, dtype=np.uint8)
        out = array(mask).reshape(-1).astype(np.uint8)
        if len(out) != self.total:
            raise RuntimeError("Selection layout differs from exported scene; relaunch VR Editor.")
        return out

    def state(self):
        self.scene = lf.get_scene()
        selected = self.selection_array()
        nodes = []
        for r in self.records:
            data = self.scene.get_node(r["name"]).splat_data()
            deleted = array(data.deleted).reshape(-1) if data.has_deleted_mask() else np.zeros(r["count"], bool)
            mask = selected[r["offset"]:r["offset"] + r["count"]]
            nodes.append({"selected": np.flatnonzero(mask).tolist(),
                          "deleted": np.flatnonzero(deleted).tolist()})
        return {"nodes": nodes, "selectionMode": self.selection_mode,
                "canUndo": lf.undo.can_undo(), "canRedo": lf.undo.can_redo()}

    def execute(self, command):
        op = command.get("op")
        if op == "paint":
            indices = np.asarray(command.get("indices", []))
            if indices.size and (not np.issubdtype(indices.dtype, np.integer) or
                                 indices.min() < 0 or indices.max() >= self.total):
                raise ValueError("Invalid selection indices")
            indices = indices.astype(np.int64)
            if not self.allowed[indices].all():
                raise ValueError("Selection contains an unexported node")
            if not self.stroke:
                self.mask = self.selection_array()
                self.stroke = True
            group = self.scene.active_selection_group or 1
            if self.scene.is_selection_group_locked(group):
                raise RuntimeError("Active selection group is locked.")
            # Preserve other groups, respecting their locks.
            editable = self.mask[indices] == 0
            self.mask[indices[editable]] = group
            self.scene.preview_selection_mask(tensor(self.mask))
        elif op == "commit":
            self.finish_stroke()
        elif op == "cancel":
            self.finish_stroke(cancel=True)
        elif op == "clear":
            self.finish_stroke()
            self.scene.clear_selection()
        elif op == "delete":
            self.finish_stroke()
            self.delete_selection()
        elif op == "undo":
            self.finish_stroke()
            lf.undo.undo()
        elif op == "redo":
            self.finish_stroke()
            lf.undo.redo()
        elif op != "state":
            raise ValueError("Unknown VR editor operation")
        return self.state()

    def delete_selection(self):
        """Soft delete splats only. Never invoke ed.delete, which removes nodes."""
        selection = self.selection_array()
        entries = []
        for r in self.records:
            data = self.scene.get_node(r["name"]).splat_data()
            local = selection[r["offset"]:r["offset"] + r["count"]]
            chosen = local != 0
            for group in np.unique(local[chosen]):
                if self.scene.is_selection_group_locked(int(group)):
                    chosen[local == group] = False
            if not chosen.any():
                continue
            before = array(data.deleted).reshape(-1).astype(bool) if data.has_deleted_mask() else np.zeros(r["count"], bool)
            after = before | chosen
            entries.append((r["name"], r["uuid"], r["count"], before, after))
        if not entries:
            return
        def restore(which):
            # Validate every target before applying any history update.
            scene = lf.get_scene()
            if scene is None:
                raise RuntimeError("Cannot restore VR deletion without a scene.")
            targets = []
            for name, uuid, count, before, after in entries:
                node = scene.get_node(name)
                if node is None or node.uuid != uuid or node.gaussian_count != count:
                    raise RuntimeError("Cannot restore VR deletion after scene topology changed.")
                targets.append((node.splat_data(), before if which == 0 else after))
            for data, mask in targets:
                data.clear_deleted()
                data.soft_delete(tensor(mask))
            scene.invalidate_cache()
            scene.notify_changed()
        restore(1)
        lf.undo.push("VR Delete Selection", lambda: restore(0), lambda: restore(1),
                     estimated_bytes=sum(e[3].nbytes + e[4].nbytes for e in entries),
                     id="lichtfeld_vr_editor.delete", scope="scene")

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "application/javascript",
                      ".css": "text/css", ".ply": "application/octet-stream"}
    def __init__(self, *args, bridge, **kwargs):
        self.bridge = bridge
        super().__init__(*args, **kwargs)

    def log_message(self, *_):
        pass

    def json(self, value, code=200):
        body = json.dumps(value).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        expected = f"127.0.0.1:{self.server.server_port}"
        origin = self.headers.get("Origin")
        return (self.headers.get("Host") == expected and
                (origin is None or origin == f"http://{expected}") and
                secrets.compare_digest(self.headers.get("X-VR-Token", ""), self.bridge.token))

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/config":
            if not self.authorized():
                return self.json({"error": "Unauthorized"}, 403)
            return self.json(self.bridge.config)
        if path.startswith("/node-") and path.endswith(".ply"):
            if not self.authorized():
                return self.json({"error": "Unauthorized"}, 403)
            name = path[1:]
            if name not in [r["file"] for r in self.bridge.records]:
                return self.json({"error": "Not found"}, 404)
            body = (Path(self.bridge.temp.name) / name).read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path not in {"/index.html", "/viewer.js", "/viewer.css", "/editor.js", "/controls.js", "/overlap.js", "/favicon.ico"}:
            return self.json({"error": "Not found"}, 404)
        super().do_GET()

    def do_POST(self):
        if self.path not in {"/command", "/diagnostics"} or not self.authorized():
            return self.json({"error": "Unauthorized"}, 403)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 32 * 1024 * 1024:
                raise ValueError("Invalid request size")
            command = json.loads(self.rfile.read(length))
            if not isinstance(command, dict):
                raise ValueError("Expected command object")
            if self.path == "/diagnostics":
                self.bridge.diagnostics.append({k: str(command.get(k, ""))[:2000] for k in ("event", "details", "time")})
                self.bridge.diagnostics = self.bridge.diagnostics[-40:]
                return self.json({"ok": True})
            event = threading.Event()
            result = {}
            self.bridge.pending.put_nowait((command, result, event))
            lf.ui.schedule_on_ui_thread(self.bridge.pump)
            if not event.wait(8):
                result["expired"] = True
                return self.json({"error": "Lichtfeld viewport is not responding. Keep it visible."}, 503)
            if "error" in result:
                return self.json({"error": result["error"]}, 409)
            self.json(result["data"])
        except (ValueError, queue.Full) as exc:
            self.json({"error": str(exc) or "Editor queue full"}, 400)
