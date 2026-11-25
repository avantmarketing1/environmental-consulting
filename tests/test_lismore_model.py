import json
from datetime import date
from pathlib import Path

from enviro_comply.engine.compliance_rules import audit_lismore_compliance
from enviro_comply.engine.lismore_model import run_lismore_wastewater_model
from enviro_comply.schemas.ossm import (
    BoreholeHorizon,
    BoreholeLog,
    BufferFeatureType,
    ConsultantDetails,
    LandApplicationType,
    SiteAssessmentInput,
    SiteEvaluationFieldData,
    SpatialPreCheckResult,
    TreatmentSystemType,
    WaterSupplyType,
)


def test_matches_lcc_excel_workbook_default_exactly():
    """Verify exact numerical parity with cached cells in reference/lcc_2014_on-site_wastewater_model.xls."""
    inp = SiteAssessmentInput(
        applicant_name="Default Test",
        site_address="Test Rd Lismore",
        lot_number="1",
        plan_label="DP100000",
        block_size_m2=2000.0,
        bedrooms=3,  # 3 + 1 = 4 persons
        water_supply=WaterSupplyType.RETICULATED_FULL_WATER_SAVING,  # 150 L/p/d -> 600 L/d
        treatment_system=TreatmentSystemType.SECONDARY_AWTS,  # 20% N removal
        land_application_type=LandApplicationType.ETA_BEDS,
        buffer_feature=BufferFeatureType.GULLY,
        buffer_distance_m=40.0,
        morand_code="ge",  # Dark Basaltic = 12,000 kg/ha.m
        soil_texture_id=9,  # Light clays - strongly structured (DLR=12, sat=158.5, awc=19.5)
        root_zone_depth_mm=150.0,
        gravel_depth_mm=250.0,
        site_eval=SiteEvaluationFieldData(
            assessment_date=date(2026, 11, 22),
            slope_pct=0.0,
            aspect="North",
            depth_to_water_table_m=3.0,
        ),
        consultant=ConsultantDetails(name="Test Consultant"),
    )

    res = run_lismore_wastewater_model(inp)
    assert res.total_flow_ld == 600.0
    assert res.bucket_cap_sat_mm == 158.5
    assert res.bucket_cap_awc_mm == 19.5
    assert res.max_deep_drainage_mmd == 12.0
    assert res.hydraulic_area_m2 == 55.3  # Excel C31 = 55.3149
    assert res.nitrogen_area_m2 == 199.2  # Excel C32 = 199.2087
    assert res.phosphorus_area_m2 == 33.5  # Excel C33 = 33.5484
    assert res.required_laa_m2 == 199.2
    assert res.limiting_factor == "Nitrogen"
    assert res.trench_layout.number_of_trenches == 5
    assert res.trench_layout.trench_length_m == 19.9


def test_matches_stony_chute_golden_report_exactly():
    """Verify exact numerical parity with ossm example/1 OSS UP-FRONT INFO PAGE.pdf (Page 8)."""
    raw = json.loads(Path("examples/stony_chute_lot5_dp625836.json").read_text(encoding="utf-8"))
    inp = SiteAssessmentInput.model_validate(raw)

    res = run_lismore_wastewater_model(inp)
    assert res.design_persons == 2
    assert res.total_flow_ld == 240.0
    assert res.n_removal_pct == 68.0  # Report p.8: 68%
    assert res.reed_bed_required_m2 == 5.6  # Report p.8: 5.6 m2
    assert res.reed_bed_hrt_days == 6.5  # Report p.8: 6.5 days
    assert res.hydraulic_area_m2 == 22.5  # Report p.8: 22.5 m2
    assert res.nitrogen_area_m2 == 0.0  # Report p.8: 0.0 m2
    assert res.phosphorus_area_m2 == 20.0  # Report p.8: 20.0 m2
    assert res.required_laa_m2 == 22.5
    assert res.trench_layout.number_of_trenches == 1
    assert res.trench_layout.trench_length_m == 11.2  # Report p.8/9: 11.2m x 2m
    assert res.septic_tank_min_l == 3000
    assert res.septic_retention_days == 12.5


def test_compliance_flags_dispersive_gypsum_and_missing_boreholes():
    raw = json.loads(Path("examples/stony_chute_lot5_dp625836.json").read_text(encoding="utf-8"))
    raw["boreholes"] = raw["boreholes"][:1]  # Only 1 borehole -> should trigger LCC s5.4.3 departure
    inp = SiteAssessmentInput.model_validate(raw)
    model = run_lismore_wastewater_model(inp)
    spatial = SpatialPreCheckResult(lot_id_string="5//DP625836", drinking_water_catchment=True)

    audit = audit_lismore_compliance(inp, spatial, model)
    assert audit.requires_gypsum is True
    assert audit.gypsum_rate_kg_m2 == 1.0
    assert audit.requires_rous_water_assessment is True
    assert any("minimum 2 boreholes" in d for d in audit.departures_from_strategy)
    assert any("Rous Water" in d for d in audit.departures_from_strategy)
