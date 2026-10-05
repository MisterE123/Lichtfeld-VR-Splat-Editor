# SPDX-License-Identifier: GPL-3.0-or-later
"""Live VR editing. Native scene operations run only on the UI thread."""
from pathlib import Path
import lichtfeld as lf
from .bridge import Bridge

_bridge = Bridge(Path(__file__).resolve().parent)

class VrEditorPanel(lf.ui.Panel):
    id = "lichtfeld_vr_editor.panel"
    label = "VR Editor"
    space = lf.ui.PanelSpace.MAIN_PANEL_TAB
    order = 111
    template = str(Path(__file__).with_name("panel.rml"))

    def draw(self, ui):
        ui.heading("Lichtfeld VR Editor")
        ui.text_wrapped(_bridge.status)
        changed, mode = ui.combo("Selection mode", 0 if _bridge.selection_mode == "center" else 1,
                                 ["Center", "Edge"])
        if changed:
            _bridge.selection_mode = "center" if mode == 0 else "edge"
        ui.text_wrapped("Center: splat center inside the tool. Edge: any overlap with the splat's 3-sigma extent.")
        if ui.button("Launch VR Editor"):
            try:
                _bridge.start()
            except Exception as exc:
                _bridge.status = str(exc)
                lf.log.error(f"VR Editor: {exc}")
        if _bridge.server and ui.button("Stop VR Editor"):
            _bridge.stop()
        ui.separator()
        ui.text_wrapped("Quest via SteamVR: open the viewer in Chrome or Edge, then click the blue Enter VR button.")
        ui.text_wrapped("Right stick: left/right turns; forward/back moves. Left stick: left/right changes selector size; up/down moves the view vertically. Right trigger: paint selection. Left trigger: sphere/box; box follows the controller.")
        ui.text_wrapped("Either grip: grab and drag to pan. BOTH grips: pan, rotate with the hand-to-hand line, and scale with hand separation together. Y: clear. X: delete. B: undo. A: redo.")
        ui.text_wrapped("Grip changes adjust your VR view. Selection and deletion edit the live Lichtfeld scene. Keep Lichtfeld running. Stop VR before training or changing scene topology.")

def on_load():
    lf.register_class(VrEditorPanel)
    lf.log.info("VR Editor loaded")

def on_unload():
    _bridge.stop()
    lf.unregister_class(VrEditorPanel)
