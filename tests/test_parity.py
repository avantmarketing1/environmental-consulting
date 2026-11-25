"""Cross-runtime parity test: asserts Python engine == Browser JS engine on all shared fixtures."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from enviro_comply.cad.dxf_builder import build_ossm_dxf_bytes
from enviro_comply.engine.compliance_rules import audit_lismore_compliance
from enviro_comply.engine.lismore_model import run_lismore_wastewater_model
from enviro_comply.schemas.ossm import FieldPin, SiteAssessmentInput, SpatialPreCheckResult

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURES_PATH = REPO_ROOT / "tests" / "fixtures" / "parity_cases.json"


def _find_node_binary() -> str | None:
    found = shutil.which("node")
    if found:
        return found
    nvm_dir = Path(os.environ.get("APPDATA", "")) / "nvm"
    if nvm_dir.exists():
        for ver in sorted(nvm_dir.glob("v*"), reverse=True):
            cand = ver / "node.exe"
            if cand.exists():
                return str(cand)
    return None


def test_python_and_js_engines_match_100_percent():
    node = _find_node_binary()
    if not node:
        pytest.skip("Node.js binary not available for cross-runtime parity check")

    proc = subprocess.run(
        [node, str(REPO_ROOT / "cloudflare-app" / "scripts" / "test-parity.mjs"), "--json"],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    js_results = json.loads(proc.stdout)
    cases = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))

    model_keys = [
        "design_persons",
        "total_flow_ld",
        "max_deep_drainage_mmd",
        "bucket_cap_sat_mm",
        "bucket_cap_awc_mm",
        "phosphorus_area_m2",
        "nitrogen_area_m2",
        "hydraulic_area_m2",
        "area_cap_m2",
        "required_laa_m2",
        "limiting_factor",
        "reed_bed_required_m2",
        "reed_bed_hrt_days",
        "n_removal_pct",
        "septic_tank_min_l",
        "grease_arrestor_min_l",
        "surge_tank_min_l",
        "exceeds_commercial_threshold_2000ld",
    ]
    audit_bool_keys = [
        "site_has_limitations",
        "soil_has_limitations",
        "overall_no_limitations",
        "requires_secondary_treatment",
        "requires_gypsum",
        "requires_rous_water_assessment",
        "requires_certified_irrigation_design",
        "requires_grease_arrestor",
        "requires_commercial_assessment",
    ]

    for case in cases:
        name = case["name"]
        inp = SiteAssessmentInput.model_validate(case["assessment"])
        sp = SpatialPreCheckResult.model_validate(case["spatial"])
        py_model = run_lismore_wastewater_model(inp).model_dump()
        py_audit = audit_lismore_compliance(inp, sp, run_lismore_wastewater_model(inp)).model_dump()

        js_case = js_results[name]
        js_model = js_case["model"]
        js_audit = js_case["audit"]

        for k in model_keys:
            assert js_model[k] == py_model[k], f"[{name}] model.{k} drift: JS={js_model[k]} vs PY={py_model[k]}"

        assert js_model["trench_layout"] == py_model["trench_layout"], f"[{name}] trench_layout drift"

        for k in audit_bool_keys:
            assert js_audit[k] == py_audit[k], f"[{name}] audit.{k} drift: JS={js_audit[k]} vs PY={py_audit[k]}"

        py_codes = [(c["code"], c["status"]) for c in py_audit["checks"]]
        js_codes = [(c["code"], c["status"]) for c in js_audit["checks"]]
        assert js_codes == py_codes, f"[{name}] compliance checks drift:\nJS={js_codes}\nPY={py_codes}"
        assert len(js_audit["departures_from_strategy"]) == len(py_audit["departures_from_strategy"]), (
            f"[{name}] departures count drift:\nJS={js_audit['departures_from_strategy']}\nPY={py_audit['departures_from_strategy']}"
        )


def test_shared_dxf_builder_supports_real_mga56_pins_and_parcel_boundary():
    import ezdxf

    cases = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))
    inp = SiteAssessmentInput.model_validate(cases[0]["assessment"])
    inp.field_pins = [
        FieldPin(label="DWELLING", feature_type="dwelling", easting_mga56=520100.0, northing_mga56=6838500.0, latitude=-28.5801, longitude=153.2055),
        FieldPin(label="SEPTIC TANK", feature_type="septic_tank", easting_mga56=520105.0, northing_mga56=6838492.0),
        FieldPin(label="ETA BED", feature_type="eta_bed", easting_mga56=520118.0, northing_mga56=6838480.0),
        FieldPin(label="BH1", feature_type="borehole", easting_mga56=520114.0, northing_mga56=6838481.0),
        FieldPin(label="BH2", feature_type="borehole", easting_mga56=520124.0, northing_mga56=6838479.0),
    ]
    spatial_data = {
        "parcel_geojson": {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[153.205, -28.580], [153.207, -28.580], [153.207, -28.582], [153.205, -28.582], [153.205, -28.580]]],
            },
        }
    }
    model = run_lismore_wastewater_model(inp)
    dxf_bytes = build_ossm_dxf_bytes(inp, model, spatial_data=spatial_data)
    assert len(dxf_bytes) > 3000

    import io
    dwg = ezdxf.read(io.StringIO(dxf_bytes.decode("utf-8")))
    layers = {l.dxf.name for l in dwg.layers}
    assert "0_PARCEL_BOUNDARY" in layers
    boundary_entities = [e for e in dwg.modelspace() if e.dxf.layer == "0_PARCEL_BOUNDARY"]
    assert len(boundary_entities) == 1
    assert any("MGA56 Origin: E520100.0 N6838500.0" in e.dxf.text for e in dwg.modelspace() if e.dxftype() == "TEXT")
