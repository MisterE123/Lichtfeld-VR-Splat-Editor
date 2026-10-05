# SPDX-License-Identifier: GPL-3.0-or-later
"""Explicit, undoable recovery of a single-node 0.1.0 VR editing session.

Run on the UI thread. Preserve existing history and add one correction step.
"""
import json
from pathlib import Path
import numpy as np
import lichtfeld as lf
from .legacy_indices import legacy_morton_order

def recover_legacy_edits(bridge, backup_directory):
    if lf.context().is_training or bridge.stroke:
        raise RuntimeError("End the stroke and pause training before recovery")
    scene = bridge.guard()
    nodes = scene.get_nodes(lf.scene.NodeType.SPLAT)
    if len(nodes) != 1 or len(bridge.records) != 1:
        raise RuntimeError("Legacy recovery requires one splat node")
    node = nodes[0]
    name, uuid, count = node.name, node.uuid, node.gaussian_count
    stack = lf.undo.stack()
    if stack["redo"] or lf.undo.has_active_transaction():
        raise RuntimeError("Recovery requires no redo stack or active transaction")
    items = stack["undo"]
    allowed = {"VR Delete Selection", "selection.histogram", "select.none"}
    if not items or any(item["label"] not in allowed for item in items):
        raise RuntimeError("Non-VR history found; manual recovery is required")
    if not any(item["label"] == "VR Delete Selection" for item in items):
        raise RuntimeError("No legacy VR deletions found")
    if len(items) >= 100:
        raise RuntimeError("No history slot available; recovery must not evict existing entries")
    directory = Path(backup_directory)
    directory.mkdir(parents=True, exist_ok=True)
    order = legacy_morton_order(node.splat_data().means_raw.cpu().numpy())

    def target():
        current = lf.get_scene()
        n = current.get_node(name) if current else None
        if n is None or n.uuid != uuid or n.gaussian_count != count:
            raise RuntimeError("Scene changed during recovery")
        return current, n.splat_data()

    current, data = target()
    selected = current.selection_mask
    mask = selected.cpu().numpy().reshape(-1) if selected is not None else np.zeros(count, np.uint8)
    ids = np.flatnonzero(mask).astype(np.uint32)
    deleted = np.flatnonzero(data.deleted.cpu().numpy().reshape(-1)).astype(np.uint32) if data.has_deleted_mask() else np.empty(0, np.uint32)
    before = (ids, mask[ids].astype(np.uint8), deleted)
    after = (order[ids], before[1].copy(), order[deleted])
    # Only edits introduced in this session are supported. The earliest retained
    # Python deletion callback captures the baseline before any VR deletion.
    import gc
    baselines = []
    for obj in gc.get_objects():
        if isinstance(obj, type(lambda: None)) and obj.__qualname__ == "Bridge.delete_selection.<locals>.restore":
            cells = dict(zip(obj.__code__.co_freevars, obj.__closure__ or ()))
            if "entries" in cells:
                for entry in cells["entries"].cell_contents:
                    if entry[1] == uuid:
                        baselines.append(int(np.count_nonzero(entry[3])))
    if not baselines or min(baselines) != 0:
        raise RuntimeError("Pre-existing deletions cannot be remapped automatically")
    size = sum(a.nbytes for state in (before, after) for a in state)
    if lf.undo.total_bytes() + size + count > lf.undo.max_bytes():
        raise RuntimeError("History memory budget cannot preserve existing entries")
    np.save(directory / "browser-to-native.npy", order)
    np.savez_compressed(directory / "original-state.npz", selected=before[0], groups=before[1], deleted=before[2])
    (directory / "history.json").write_text(json.dumps({"name": name, "uuid": uuid, "count": count, "items": items}), encoding="utf-8")

    def apply(state):
        current, data = target()
        selected_ids, values, deleted_ids = state
        data.clear_deleted()
        selection = np.zeros(count, np.uint8); selection[selected_ids] = values
        current.set_selection_mask(lf.Tensor.from_numpy(selection).cuda())
        if len(deleted_ids):
            deletion = np.zeros(count, bool); deletion[deleted_ids] = True
            data.soft_delete(lf.Tensor.from_numpy(deletion).cuda())
        current.notify_changed(); lf.ui.request_redraw()

    bridge.stop()
    # A transaction retains the existing entries and adds a single reversible
    # correction; the selection setter's native history entry joins this group.
    with lf.undo.transaction("Repair VR Deletion Indices"):
        lf.undo.push("Repair VR Deletion Indices", lambda: apply(before), lambda: apply(after),
                     id="lichtfeld_vr_editor.repair_indices", source="python", scope="scene", estimated_bytes=size)
        apply(after)
    current, data = target()
    actual = np.flatnonzero(data.deleted.cpu().numpy().reshape(-1)) if data.has_deleted_mask() else np.empty(0, np.uint32)
    if not np.array_equal(np.sort(after[2]), actual):
        lf.undo.undo()
        raise RuntimeError("Recovery verification failed and was undone")
    if lf.undo.undo_names()[1:] != [item["label"] for item in items]:
        raise RuntimeError("History preservation verification failed")
    return {"deleted": len(after[2]), "existing_history_entries": len(items),
            "remapped_ids": int(np.count_nonzero(order[deleted] != deleted)),
            "backup_directory": str(directory)}
