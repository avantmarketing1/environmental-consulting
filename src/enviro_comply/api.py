"""FastAPI backend exposing Desktop Pre-Check, Deterministic Sizing, and Full Report Generation.

Ready for Phase 2 Next.js Desktop Workbench & Offline-First Field Capture PWA integration.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.responses import FileResponse

from enviro_comply.engine.compliance_rules import audit_lismore_compliance
from enviro_comply.engine.lismore_model import load_lismore_rules, run_lismore_wastewater_model
from enviro_comply.pipeline import run_ossm_pipeline
from enviro_comply.schemas.ossm import (
    OSSMReportBundle,
    SiteAssessmentInput,
    SpatialPreCheckResult,
    WastewaterModelResult,
)
from enviro_comply.spatial.nsw_arcgis import run_spatial_precheck

app = FastAPI(
    title="EnviroComply — Lismore OSSM Compliance API",
    version="0.1.0",
    description="Deterministic NSW spatial pre-check, Lismore CC OSmodel sizing, AutoCAD DXF & Section 68 DOCX engine.",
)

DEFAULT_OUTPUT_DIR = Path("outputs")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "lga": "Lismore City Council", "engine": "OSmodel300614-python"}


@app.get("/rules/lismore")
def get_lismore_rules() -> dict:
    return load_lismore_rules()


@app.get("/spatial/precheck", response_model=SpatialPreCheckResult)
def spatial_precheck(
    lot: str = Query(..., description="Lot number, e.g. 5"),
    plan: str = Query(..., description="Plan label, e.g. DP123456"),
    section: str | None = Query(None, description="Optional section number"),
    offline: bool = Query(False),
) -> SpatialPreCheckResult:
    return run_spatial_precheck(lot_number=lot, plan_label=plan, section_number=section, offline=offline)


@app.post("/model/calculate", response_model=WastewaterModelResult)
def calculate_model(payload: SiteAssessmentInput) -> WastewaterModelResult:
    return run_lismore_wastewater_model(payload)


@app.post("/reports/generate", response_model=OSSMReportBundle)
def generate_report(
    payload: SiteAssessmentInput,
    offline_spatial: bool = Query(False),
) -> OSSMReportBundle:
    return run_ossm_pipeline(payload, output_dir=DEFAULT_OUTPUT_DIR, offline_spatial=offline_spatial)


@app.get("/outputs/{filename}")
def download_output(filename: str) -> FileResponse:
    path = (DEFAULT_OUTPUT_DIR / Path(filename).name).resolve()
    return FileResponse(path)
