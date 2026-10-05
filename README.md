# Lichtfeld VR Editor

Quest / SteamVR extension for live Gaussian splat selection and editing in Lichtfeld Studio.

The installable extension is in [outputs/lichtfeld_vr_editor](outputs/lichtfeld_vr_editor/README.md). Its README describes setup, controller bindings, Center/Edge selection, and limitations. [Verification notes](outputs/lichtfeld_vr_editor/TESTING.md) distinguish automated checks from headset verification.

Run the geometry and controller checks with Node.js:

```sh
node tests/test_controls.mjs
node tests/test_overlap.mjs
```

Local investigation files, virtual environments, and scene recovery copies are excluded from Git. The extension is GPL-3.0-or-later; see its LICENSE and THIRD_PARTY.md.
