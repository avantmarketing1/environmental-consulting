from pathlib import Path

import docx

from enviro_comply.engine.see_rules import audit_lismore_see
from enviro_comply.report.see_docx_builder import build_see_docx_report
from enviro_comply.schemas.ossm import SpatialPreCheckResult
from enviro_comply.schemas.see import SEEAssessmentInput, SEECustomNarratives, SEEDevelopmentType


def test_lismore_see_audit_and_docx_for_agritourism_ru1_bushfire_lot(tmp_path: Path):
    spatial = SpatialPreCheckResult(
        lot_id_string="15//DP747641",
        fetched_live=True,
        parcel_area_m2=437461.4,
        parcel_area_ha=43.75,
        centroid_lat=-28.679384,
        centroid_lon=153.24532,
        centroid_easting_mga56=523967.5,
        centroid_northing_mga56=6827510.4,
        land_zoning=["RU1 — Primary Production"],
        min_lot_size=["40 — ha"],
        flood_planning=False,
        bushfire_prone_land=["3 — Vegetation Category 3"],
        nearest_watercourse_m=0.0,
    )

    inp = SEEAssessmentInput(
        project_ref="FTF-2026-176-SEE",
        applicant_name="Luke James Coyle",
        site_address="273 Koonorigan Road, Koonorigan NSW 2480",
        lot_number="15",
        plan_label="DP747641",
        block_size_m2=437461.0,
        development_type=SEEDevelopmentType.AGRITOURISM_FARM_STAY,
        proposal_title="Proposed Agritourism Eco-Cabins (3x 1-BR) & Farm-Gate Processing Shed",
        estimated_cost_aud=620000.0,
        gross_floor_area_m2=240.0,
        building_height_m=5.4,
        storeys=1,
        operating_hours="Thu–Sun 9:00 am – 4:00 pm (farm-gate); 24/7 guest cabins",
        staff_or_guests_max="Max 6 overnight guests + 2 staff",
        linked_ossm_summary="Concurrent Section 68 OSSM System: 1,650 L/d -> 1,000 L Grease Arrestor -> 4,500 L Septic -> Reed Bed -> ETA Beds",
        custom_narratives=SEECustomNarratives(
            executive_summary="This Statement of Environmental Effects supports an ecologically regenerative agritourism development in Koonorigan.",
            ai_model_used="gemini-4-hydrogen",
        ),
    )

    audit = audit_lismore_see(inp, spatial)
    assert audit.detected_zone_code == "RU1"
    assert "Integrated Development" in audit.da_pathway  # Bushfire + Agritourism triggers RFS s100B
    assert any(c.code == "RFS-PBP" and c.compliance == "TRIGGERED" for c in audit.checks)
    assert any(c.code == "LEP-6.9" and c.compliance == "COMPLIANT" for c in audit.checks)
    assert any(c.code == "DCP-CH22" for c in audit.checks)

    out_docx = tmp_path / "Lot15_DP747641_Lismore_SEE.docx"
    build_see_docx_report(inp, spatial, audit, out_docx)
    assert out_docx.exists() and out_docx.stat().st_size > 20_000

    d = docx.Document(str(out_docx))
    full_text = "\n".join(p.text for p in d.paragraphs) + "\n" + "\n".join(
        cell.text for tbl in d.tables for row in tbl.rows for cell in row.cells
    )
    assert "STATEMENT OF ENVIRONMENTAL EFFECTS (SEE)" in full_text
    assert "Lismore Local Environmental Plan (LEP) 2012" in full_text
    assert "Lismore Development Control Plan (DCP) 2012" in full_text
    assert "ecologically regenerative agritourism development in Koonorigan" in full_text
    assert "1,000 L Grease Arrestor" in full_text
    assert "Bushfire Attack Level (BAL)" in full_text
