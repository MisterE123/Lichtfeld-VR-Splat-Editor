# Verification

Verified against the installed Lichtfeld Nightly v0.5.3-759-gf66c82a3 on October 5, 2026.

## 0.1.1 deletion correction

- Reproduced the root cause using the bundled engine's actual `calcMortonOrder` and `reorderData`: render row zero referred to native row one. Prior count-only tests did not catch this mismatch.
- Regression checks cover explicit native IDs through property reordering, inverse deletion-state mapping, duplicate/invalid IDs, and stable sorting of duplicate positions. Exports contain an unsigned 32-bit `lfs_index` property; the loader disables reordering and the editor still translates IDs explicitly.
- Separate eight-splat native fixture with deliberately shuffled positions verifies exported IDs and positions, exact native deletion targets `[1, 7]`, shared undo/redo, and six visible splats. Saving and reopening a `.licht` project preserves those exact deletion IDs.
- The corrected viewer loads this fixture in the in-app browser, reaches Ready, and reports no console warnings or errors. This verifies the actual PLY parser retains the native IDs.
- An optional legacy correction utility passed an isolated fixture test: one repair transaction preserves the existing history, can be undone/redone, and supports traversing all original entries. Live recovery was refused because additional non-VR history appeared; no correction was applied to that scene.
- Installed and activated the new writer without re-registering the live plugin UI. Verification against the user's headset scene is pending.

## Earlier checks

- Installed plugin passes Lichtfeld's `plugin check`.
- JavaScript syntax and controller math checks pass, including combined panning/rotation/scaling, rebased grab transitions, oriented box containment, sphere boundaries, degenerate grips, deadzones, and Quest button indices. The latest movement changes still need headset verification.
- Center/Edge geometry checks pass: tangency, anisotropic Gaussian extents, rotated ellipsoids, box-corner rejection, and 2,000 seeded analytic sphere/box overlap comparisons. The new panel dropdown uses the installed Nightly's documented UI combo API; its live UI and headset behavior still need user verification.
- Separate native Lichtfeld fixture confirms plugin registration, stable PLY export, one-step selection strokes, shared undo/redo, soft deletion undo/redo, selection clear/cancel, and invalid-index rejection.
- Browser smoke test renders splats and shows selected/deleted state with no browser errors.
- Live scene launches with 1 visible splat node and 6,561,004 Gaussians.
- A separate large-scene instance exported 6,561,004 Gaussians and passed 30 read-only state checks in 2.02 seconds without a crash.
- SteamVR is configured as the active OpenXR runtime. Edge detected immersive VR; Chrome initially returned `isSessionSupported('immersive-vr') = false` and `XR is not available`. The user confirmed VR works after restarting. The launcher uses the system default browser without preferring Edge.
- A native Lichtfeld access-violation dialog occurred during live testing/reloading. Its cause is not established. Startup loading is disabled in the installed plugin, and further testing must use a fresh isolated process rather than reloading the live plugin. Full headset/controller interaction and stability testing remain incomplete.
- The user subsequently confirmed that VR works after restarting Chrome and possibly Lichtfeld.
