# Third-party code

The existing installed `splat_vr_viewer` supplied `viewer.js`, `viewer.css`, and `index.html`. Its README declares GPL-3.0-or-later. The copied bundle reports SuperSplat Viewer 1.11.0 and PlayCanvas 2.15.1 revision 70fef1e.

- Lichtfeld Studio: https://github.com/MrNeRF/LichtFeld-Studio (GPL-3.0-or-later)
- PlayCanvas Engine: https://github.com/playcanvas/engine (MIT)
- SuperSplat Viewer: https://github.com/playcanvas/supersplat-viewer (MIT)

Changes replace the original VR navigation and X/Y exit handling with a separate live editor controller. Engine and rendering code remain bundled from the existing installation. The existing plugin itself is unchanged.
