"""End-to-end OSSM Field-to-Lodgement orchestration pipeline."""

from __future__ import annotations

import json
from pathlib import Path

from enviro_comply.cad.dxf_generator import generate_ossm_cad_plan
from enviro_comply.engine.compliance_rules import audit_lismore_compliance
from enviro_comply.engine.lismore_model import run_lismore_wastewater_model
from enviro_comply.report.diagrams import generate_all_report_diagrams
from enviro_comply.report.docx_builder import build_ossm_docx_report
from enviro_comply.schemas.ossm import OSSMReportBundle, SiteAssessmentInput
from enviro_comply.spatial.map_renderer import render_gis_site_map
from enviro_comply.spatial.nsw_arcgis import run_spatial_precheck


def run_ossm_pipeline(
    inp: SiteAssessmentInput,
    output_dir: Path,
    offline_spatial: bool = False,
) -> OSSMReportBundle:
    """Execute the complete deterministic compliance pipeline for a Lismore OSSM job:
    1. Live NSW Spatial Services & Planning Portal GIS Pre-Check (GDA2020 / MGA Zone 56)
    2. Exact LCC Daily Wastewater Model (7,670-day Alstonville climate balance + N + P + Reed Bed)
    3. Deterministic LCC Strategy (2013) Compliance & Buffer Audit
    4. Print-ready GIS Site Location & Buffer Map (PNG + PDF)
    5. Layered AutoCAD DXF Engineering Layout Plan + Preview (DXF + PNG + PDF)
    6. Council-ready Section 68 Microsoft Word Report (.docx) + Audit JSON bundle
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    slug = f"{inp.project_ref}_Lot{inp.lot_number}_{inp.plan_label}".replace(" ", "_")

    # 1. Spatial Pre-Check
    spatial = run_spatial_precheck(
        lot_number=inp.lot_number,
        plan_label=inp.plan_label,
        section_number=inp.section_number,
        offline=offline_spatial,
    )

    # 2. Deterministic Wastewater Calculations
    model = run_lismore_wastewater_model(inp)

    # 3. Deterministic Strategy Compliance Audit
    audit = audit_lismore_compliance(inp, spatial, model)

    # 4. GIS Map
    gis_png = output_dir / f"{slug}_GIS_Site_Map.png"
    gis_pdf = output_dir / f"{slug}_GIS_Site_Map.pdf"
    render_gis_site_map(inp, spatial, gis_png, gis_pdf)

    # 5. AutoCAD DXF + Vector Preview
    cad_dxf = output_dir / f"{slug}_Layout_Plan.dxf"
    cad_png = output_dir / f"{slug}_Layout_Plan.png"
    cad_pdf = output_dir / f"{slug}_Layout_Plan.pdf"
    generate_ossm_cad_plan(inp, model, cad_dxf, cad_png, cad_pdf, spatial_data=spatial.model_dump())

    # 5b. Programmatic Engineering Cross-Sections & Treatment Train
    diag_dir = output_dir / "diagrams"
    diagrams = generate_all_report_diagrams(inp, model, audit, diag_dir, slug)

    # Collect any attached site photos that exist on disk
    photo_items: list[tuple[Path, str]] = []
    for ph in inp.photos:
        if ph.file_path:
            p = Path(ph.file_path)
            if p.exists():
                gps = f" (Lat {ph.latitude:.5f}, Lon {ph.longitude:.5f})" if ph.latitude and ph.longitude else ""
                photo_items.append((p, f"{ph.caption}{gps}"))

    # 6. Council-ready .docx Report
    report_docx = output_dir / f"{slug}_OSSM_Report.docx"
    build_ossm_docx_report(
        inp=inp,
        spatial=spatial,
        model=model,
        audit=audit,
        out_docx=report_docx,
        gis_map_png=gis_png,
        cad_plan_png=cad_png,
        diagrams=diagrams,
        photo_items=photo_items,
    )

    bundle = OSSMReportBundle(
        input=inp,
        spatial=spatial,
        model=model,
        audit=audit,
        generated_files={
            "docx_report": str(report_docx.resolve()),
            "cad_dxf": str(cad_dxf.resolve()),
            "cad_preview_pdf": str(cad_pdf.resolve()),
            "cad_preview_png": str(cad_png.resolve()),
            "gis_map_pdf": str(gis_pdf.resolve()),
            "gis_map_png": str(gis_png.resolve()),
        },
    )

    audit_json = output_dir / f"{slug}_Audit_Bundle.json"
    # Exclude heavy raw GIS polygon lists from the concise audit summary JSON? Keep full bundle for audit trail!
    audit_json.write_text(bundle.model_dump_json(indent=2), encoding="utf-8")
    bundle.generated_files["audit_json"] = str(audit_json.resolve())
    return bundle
