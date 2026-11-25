import json
from pathlib import Path

from fastapi.testclient import TestClient

from enviro_comply.api import app

client = TestClient(app)


def test_api_health_and_rules():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["lga"] == "Lismore City Council"

    rules = client.get("/rules/lismore")
    assert rules.status_code == 200
    assert len(rules.json()["morand_soil_units"]) == 27


def test_api_model_calculate_stony_chute():
    raw = json.loads(Path("examples/stony_chute_lot5_dp625836.json").read_text(encoding="utf-8"))
    r = client.post("/model/calculate", json=raw)
    assert r.status_code == 200
    data = r.json()
    assert data["required_laa_m2"] == 22.5
    assert data["reed_bed_required_m2"] == 5.6
    assert data["reed_bed_hrt_days"] == 6.5
    assert data["n_removal_pct"] == 68.0
