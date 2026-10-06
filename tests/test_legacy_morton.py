"""Cross-check recovery's permutation against the actual bundled engine."""
import importlib.util
import json
from pathlib import Path
import subprocess
import numpy as np

root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("legacy_indices",root/"legacy_indices.py")
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
output=subprocess.check_output(["node",str(root/"tests/test_native_indices.mjs"),"--fixture"],text=True)
fixture=json.loads(output.strip().splitlines()[-1])
actual=module.legacy_morton_order(np.array(fixture["points"],dtype=np.float32))
np.testing.assert_array_equal(actual,fixture["order"])
np.testing.assert_array_equal(module.legacy_morton_order(np.zeros((4,3),np.float32)),[0,1,2,3])
print("Legacy recovery permutation matches the actual engine on 257 seeded positions, duplicate rows, and degenerate axes.")

