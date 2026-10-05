# SPDX-License-Identifier: GPL-3.0-or-later
"""Exact PlayCanvas Morton permutation used by the original 0.1.0 viewer."""
import numpy as np

def legacy_morton_order(means):
    points = np.asarray(means)
    if points.ndim != 2 or points.shape[1] != 3 or not np.isfinite(points).all():
        raise ValueError("Legacy recovery requires finite XYZ positions")
    codes = np.zeros(len(points), dtype=np.uint32)
    for axis in range(3):
        values = points[:, axis].astype(np.float64)
        lo, hi = values.min(), values.max()
        cells = np.zeros(len(points), dtype=np.uint32) if lo == hi else np.minimum(
            1023, np.floor((values - lo) * (1024 / (hi - lo)))).astype(np.uint32)
        cells &= 0x000003ff
        cells = (cells ^ (cells << 16)) & 0xff0000ff
        cells = (cells ^ (cells << 8)) & 0x0300f00f
        cells = (cells ^ (cells << 4)) & 0x030c30c3
        cells = (cells ^ (cells << 2)) & 0x09249249
        codes += cells << axis
    return np.argsort(codes, kind="stable").astype(np.uint32)

def remap_sparse(indices, order):
    return order[np.asarray(indices, dtype=np.int64)]
