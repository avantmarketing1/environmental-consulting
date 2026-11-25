import json
from pathlib import Path

import docx
import ezdxf

from enviro_comply.pipeline import run_ossm_pipeline
from enviro_comply.schemas.ossm import SiteAssessmentInput


def test_full_offline_pipeline_generates_valid_docx_dxf_and_maps(tmp_path: Path):
    raw = json.loads(Path("examples/stony_chute_lot5_dp625836.json").read_text(encoding="utf-8"))
    inp = SiteAssessmentInput.model_validate(raw)

    bundle = run_ossm_pipeline(inp, output_dir=tmp_path, offline_spatial=True)

    docx_path = Path(bundle.generated_files["docx_report"])
    dxf_path = Path(bundle.generated_files["cad_dxf"])
    gis_pdf = Path(bundle.generated_files["gis_map_pdf"])
    cad_pdf = Path(bundle.generated_files["cad_preview_pdf"])

    assert docx_path.exists() and docx_path.stat().st_size > 20_000
    assert dxf_path.exists() and dxf_path.stat().st_size > 5_000
    assert gis_pdf.exists() and gis_pdf.stat().st_size > 5_000
    assert cad_pdf.exists() and cad_pdf.stat().st_size > 5_000

    # Verify DXF opens cleanly with expected layers
    dwg = ezdxf.readfile(str(dxf_path))
    layer_names = {l.dxf.name for l in dwg.layers}
    assert {"1_DWELLING", "2_SEPTIC_TANK", "3_REED_BED", "4_ETA_BED", "5_RESERVE_LAA", "8_DIVERSION_SWALE"}.issubset(layer_names)

    # Verify DOCX opens cleanly and contains consistent, single-source-of-truth values (no 480L copy-paste drift!)
    d = docx.Document(str(docx_path))
    full_text = "\n".join(p.text for p in d.paragraphs) + "\n" + "\n".join(
        cell.text for tbl in d.tables for row in tbl.rows for cell in row.cells
    )
    assert "Mrs Eva Jeray" in full_text
    assert "240 L/day" in full_text
    assert "22.5 m²" in full_text
    assert "480L" not in full_text
    assert "VERA JRRAY" not in full_text

    # Verify full LCC Strategy Part B s1.1 & Wallaby Rd completeness + new report polish
    assert "Table of Contents" in full_text
    assert "Document Control & Revision History" in full_text
    assert "OSmodel300614 Council Officer Verification Summary" in full_text
    assert "System Selection Justification" in full_text
    assert "Overall Site & Soil Limitation Determination" in full_text
    assert "Daily Loading Rate (DLR / LTR) Verification" in full_text
    assert "Site Inspection Photographs" in full_text
    assert "Homeowner Guide & Component Operation / Maintenance Manuals" in full_text
    assert "Statutory Installation Steps for NSW Licensed Plumber" in full_text
    assert "Owner's Acknowledgement" in full_text
    assert "Workbench" not in full_text  # Never leak internal UI instructions into council reports

    # Verify true Word Heading 1 styles, repeating table headers (tblHeader), and cover-page header/footer isolation
    assert any(p.style.name == "Heading 1" for p in d.paragraphs)
    assert d.sections[0].different_first_page_header_footer is True
    doc_xml = d.element.xml
    assert "w:tblHeader" in doc_xml
    assert "w:cantSplit" in doc_xml
    assert "TOC \\o" in doc_xml

    # Verify embedded figures: Treatment Train + GIS Site Map + Borehole Profile + Sizing Chart + CAD Plan + Septic XSec + Reed Bed XSec + ETA XSec = 8
    assert len(d.inline_shapes) >= 8, f"Expected >= 8 embedded drawings in DOCX, found {len(d.inline_shapes)}"


def test_multi_use_agritourism_food_processing_with_grease_trap_and_custom_narratives(tmp_path: Path):
    raw = json.loads(Path("examples/stony_chute_lot5_dp625836.json").read_text(encoding="utf-8"))
    raw["project_ref"] = "FTF-2026-FARM-MIX"
    raw["development_category"] = "mixed_farm_development"
    raw["development_description"] = "Mixed Agritourism (3x Eco-Cabins), Primary Dwelling & On-Farm Food Processing Kitchen"
    raw["grease_arrestor_required"] = True
    raw["wastewater_sources"] = [
        {"label": "Primary Dwelling", "source_type": "dwelling", "units": 1, "bedrooms_per_unit": 3},
        {"label": "Agritourism Eco-Cabins", "source_type": "agritourism_cabin", "units": 3, "bedrooms_per_unit": 1, "guests_per_unit": 2, "peak_surge_factor": 1.2},
        {"label": "On-Farm Food Processing Shed", "source_type": "food_processing_commercial", "units": 1, "bedrooms_per_unit": 0, "daily_flow_l_override": 450, "influent_bod_mgl": 650, "requires_grease_trap": True},
    ]
    raw["custom_narratives"] = {
        "executive_summary": "This bespoke Field To Forest report addresses a regenerative mixed farm development combining residence, 3 eco-cabins, and an artisan food processing kitchen.",
        "commercial_trade_waste_notes": "All commercial kitchen washdown lines discharge exclusively via the 1,000 L AS/NZS 3500.2 grease arrestor prior to combining with domestic flows.",
        "custom_om_notes": "Provide laminated eco-cabin guest cards instructing visitors to avoid harsh bleach and wipes.",
        "ai_model_used": "gemini-4-hydrogen",
    }
    inp = SiteAssessmentInput.model_validate(raw)

    bundle = run_ossm_pipeline(inp, output_dir=tmp_path, offline_spatial=True)
    m = bundle.model
    assert len(m.source_breakdown) == 3
    assert m.grease_arrestor_min_l >= 1000
    assert m.surge_tank_min_l >= 1500
    assert m.weighted_influent_bod_mgl > 300.0
    assert bundle.audit.requires_grease_arrestor is True

    d = docx.Document(bundle.generated_files["docx_report"])
    full_text = "\n".join(p.text for p in d.paragraphs) + "\n" + "\n".join(
        cell.text for tbl in d.tables for row in tbl.rows for cell in row.cells
    )
    assert "Multi-Use / Commercial Wastewater Source Breakdown" in full_text
    assert "Commercial Grease Arrestor" in full_text
    assert "Appendix C — Commercial / Multi-Use" in full_text
    assert "artisan food processing kitchen" in full_text
    assert "laminated eco-cabin guest cards" in full_text
    # 9 embedded figures: Treatment Train + GIS Map + Borehole Profile + Sizing Chart + CAD Plan + Grease Arrestor XSec + Septic XSec + Reed Bed XSec + ETA XSec
    assert len(d.inline_shapes) >= 9, f"Expected >= 9 embedded drawings incl. Grease Arrestor, Borehole & Sizing charts, found {len(d.inline_shapes)}"
