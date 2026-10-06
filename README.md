# Lichtfeld VR Editor

Quest controllers through SteamVR, using the installed Nightly's Python plugin API and a WebXR splat renderer. This is a separate plugin; the existing Splat VR Viewer stays installed.

## Start

Install directly from Lichtfeld's plugin manager using `https://github.com/MisterE123/Lichtfeld-VR-Splat-Editor`. The repository root contains the plugin manifest, Python entry point, and viewer assets. Version 0.1.2 corrects the repository layout for URL installation.

1. Restart Lichtfeld Nightly, then enable **lichtfeld_vr_editor** in its plugin manager if needed.
2. Connect Quest to the PC, start SteamVR, and ensure SteamVR is the active OpenXR runtime.
3. Load your scene in Lichtfeld and pause training. Open the **VR Editor** tab and click **Launch VR Editor**.
4. Open the launched localhost URL in Chrome or Edge if your default browser does not support WebXR. Click the blue **Enter VR** button at the top right. The button requests an immersive headset session directly and reports errors on the page. It changes to **Exit VR** only once a session starts.
5. Keep Lichtfeld running. Save the Lichtfeld project normally when done.

## Controls

| Input | Action |
| --- | --- |
| Right joystick left/right | Turn the view about the headset (90 degrees/second at full deflection) |
| Right joystick forward/back | Move forward/back in the headset's horizontal viewing direction |
| Either inner grip held | Grab and drag the scene to pan it |
| Both inner grips held | Pan with the hand midpoint, rotate from the hand-to-hand direction, and scale from hand separation, simultaneously |
| Left joystick left/right | Left decreases and right increases selector radius or box half-size |
| Left joystick up/down | Move the view vertically up/down |
| Right trigger held | Add splats inside the selector to selection; release commits one undo step |
| Left trigger press | Switch sphere / box |
| Y | Clear Gaussian selection |
| X | Soft-delete selected Gaussians |
| B | Undo through Lichtfeld's shared history |
| A | Redo through Lichtfeld's shared history |

The selector sits 15 cm ahead of the right controller. The box rotates with the controller, and selection uses that same orientation. Sphere diameter and box side length are twice the selected size. Buttons act once per press. One grip pans without rotating or scaling; two grips apply all three together around the moving hand midpoint. Adding or releasing a grip rebases the gesture without a jump. Painting pauses while grabbing. The hand-to-hand line determines scene rotation; twisting both controllers about an unchanged line does not rotate the scene.

In Lichtfeld's **VR Editor** panel, **Selection mode** chooses **Center** (default) or **Edge**. Center selects a Gaussian when its center lies inside the sphere or oriented box. Edge also selects Gaussians whose 3-sigma ellipsoid overlaps the tool, including tangential contact. It accounts for Gaussian size, rotation, node transforms, and the VR viewing scale. Gaussian tails extend indefinitely; the finite 3-sigma extent defines the selectable edge. Edge mode can take longer on large scenes. Changes synchronize to an open viewer on its next state update; changing mode ends the current selection stroke. The choice lasts for the current Lichtfeld session.

## Editing and scope

Selection and deletion affect the **live Lichtfeld scene**, including its shared undo stack. Selection is additive and supports repeated strokes. X deletes splats, never scene nodes; deletion can be undone with B. Locked groups are preserved during deletion. A lost controller, closed browser, or interrupted connection cancels an unfinished selection stroke.

Version 0.1.1 fixes incorrect deletion targets in 0.1.0: the browser's PLY loader sorted splats into a different order, while editing commands used row numbers as Lichtfeld indices. Exports now include explicit native IDs, and both editing commands and displayed selection/deletion state use those IDs. Loader reordering is also disabled. Stop and launch a fresh session after updating; refreshing an old session does not replace its exported scene. Earlier deletion targets are not automatically repaired.

Grip panning/rotation/scale and joystick navigation change your **VR viewing transform**. They do not change stored node transforms. This permits looking around and enlarging the scene without changing the project. All visible Gaussian splat nodes, including their parent transforms, are exported. Meshes, point clouds, crop filters, and editor overlays are not exported. Mirrored/sheared/singular node transforms require baking before launch.

Scene geometry is captured at launch. Selection and soft-deletion state synchronize while running. Stop and relaunch after loading another scene, editing node transforms/visibility, changing Gaussian geometry, or changing topology. Do not train while VR editing. Large scenes can stall during export, selection scans, or state transfer; this Python/browser bridge is not a native zero-copy VR renderer.

The service binds only to the local PC and uses a per-launch token. It cannot be opened directly in the standalone Quest browser; use the PC browser through SteamVR. A desktop **Exit VR** button and browser Escape leave VR; X/Y are reserved for editing. Controller tracking and immersive performance require testing with a connected headset.

## Files and license

`__init__.py` registers the panel. `bridge.py` exports stable PLY indices and schedules undoable edits through Lichtfeld's UI-thread scheduler. `viewer/editor.js` implements WebXR controls and feedback; `viewer/controls.js` holds independently tested control math, and `viewer/overlap.js` tests finite Gaussian ellipsoids against the tool. Local diagnostics record session requests, errors, and controller tracking for troubleshooting.

GPL-3.0-or-later, matching the existing viewer plugin. The bundled viewer includes PlayCanvas and SuperSplat Viewer code; see THIRD_PARTY.md.

## Development checks

Run `node tests/test_controls.mjs`, `node tests/test_overlap.mjs`, and `node tests/test_native_indices.mjs`. With Python and NumPy installed, run `python tests/test_legacy_morton.py`. See TESTING.md for native fixture and browser verification. Local scenes, virtual environments, and investigation files are excluded from Git.
