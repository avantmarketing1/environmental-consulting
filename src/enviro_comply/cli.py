"""Command-line interface for EnviroComply Lismore OSSM automation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from enviro_comply.pipeline import run_ossm_pipeline
from enviro_comply.schemas.ossm import SiteAssessmentInput
from enviro_comply.spatial.nsw_arcgis import run_spatial_precheck


def main() -> None:
    parser = argparse.ArgumentParser(prog="enviro-comply", description="Lismore City Council OSSM Automation CLI")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_pre = sub.add_parser("precheck", help="Run live NSW GIS Desktop Pre-Check for a Lot/DP")
    p_pre.add_argument("--lot", required=True, help="Lot number (e.g. 5)")
    p_pre.add_argument("--plan", required=True, help="Plan label (e.g. DP123456)")
    p_pre.add_argument("--section", default=None, help="Optional section number")
    p_pre.add_argument("--offline", action="store_true")

    p_gen = sub.add_parser("generate", help="Run full Field-to-Lodgement pipeline from a SiteAssessment JSON file")
    p_gen.add_argument("input_json", type=Path, help="Path to SiteAssessmentInput JSON file")
    p_gen.add_argument("--out", type=Path, default=Path("outputs"), help="Output directory")
    p_gen.add_argument("--offline", action="store_true", help="Skip live NSW GIS calls")

    args = parser.parse_args()

    if args.cmd == "precheck":
        res = run_spatial_precheck(lot_number=args.lot, plan_label=args.plan, section_number=args.section, offline=args.offline)
        summary = res.model_dump(exclude={"parcel_geometry_mga56", "neighbour_parcels_mga56", "watercourses_mga56", "contours_mga56"})
        print(json.dumps(summary, indent=2))
    elif args.cmd == "generate":
        raw = json.loads(args.input_json.read_text(encoding="utf-8"))
        inp = SiteAssessmentInput.model_validate(raw)
        bundle = run_ossm_pipeline(inp, output_dir=args.out, offline_spatial=args.offline)
        print(f"=== OSSM PIPELINE COMPLETE: {inp.project_ref} ===")
        print(f"Site:         {inp.site_address} (Lot {inp.lot_number} {inp.plan_label})")
        print(f"Live GIS:     {bundle.spatial.fetched_live} (Area: {bundle.spatial.parcel_area_ha} ha, Zoning: {bundle.spatial.land_zoning})")
        print(f"Design Flow:  {bundle.model.total_flow_ld:.0f} L/d ({bundle.model.design_persons} EP @ {bundle.model.flow_rate_lpd:.0f} L/p/d)")
        print(f"Required LAA: {bundle.model.required_laa_m2:.1f} m2 ({bundle.model.limiting_factor}) -> {bundle.model.trench_layout.number_of_trenches}x {bundle.model.trench_layout.trench_length_m:.1f}m x {bundle.model.trench_layout.trench_width_m:.1f}m")
        if bundle.model.reed_bed_required_m2 > 0:
            print(f"Reed Bed:     {bundle.model.reed_bed_required_m2:.1f} m2 (HRT {bundle.model.reed_bed_hrt_days} d, N removal {bundle.model.n_removal_pct}%) -> {bundle.model.recommended_reed_bed_count}x {bundle.model.recommended_reed_bed_model}")
        print(f"Departures:   {len(bundle.audit.departures_from_strategy)}")
        for k, v in bundle.generated_files.items():
            print(f"  [{k}] {v}")


if __name__ == "__main__":
    main()
