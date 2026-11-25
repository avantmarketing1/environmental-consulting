"""Programmatic AutoCAD DXF + Vector Preview generator for Lismore OSSM Site Layout Plans.

Replaces hand-drawn site layout sketches with a deterministic, scaled, multi-layered `.dxf`
(readable natively in AutoCAD, BricsCAD, and QGIS) plus a crisp preview PNG/PDF for embedding
directly into the council Section 68 report.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Circle, FancyBboxPatch, Rectangle

from enviro_comply.cad.dxf_builder import build_ossm_dxf_bytes, resolve_layout_geometry
from enviro_comply.schemas.ossm import (
    SiteAssessmentInput,
    WastewaterModelResult,
)


def generate_ossm_cad_plan(
    inp: SiteAssessmentInput,
    model: WastewaterModelResult,
    out_dxf: Path,
    out_preview_png: Path,
    out_preview_pdf: Path | None = None,
    spatial_data: dict[str, Any] | None = None,
) -> tuple[Path, Path, Path | None]:
    """Generate a layered AutoCAD .dxf site layout plan and matching scaled PNG/PDF preview."""
    out_dxf.parent.mkdir(parents=True, exist_ok=True)
    out_preview_png.parent.mkdir(parents=True, exist_ok=True)

    lay = resolve_layout_geometry(inp, model, spatial_data=spatial_data)
    tr = model.trench_layout

    # --- 1. BUILD AUTOCAD DXF (SINGLE SOURCE OF TRUTH SHARED WITH BROWSER PYODIDE) ---
    dxf_bytes = build_ossm_dxf_bytes(inp, model, spatial_data=spatial_data, layout=lay)
    out_dxf.write_bytes(dxf_bytes)

    dw_x, dw_y, dw_w, dw_l = lay.dw_x, lay.dw_y, lay.dw_w, lay.dw_l
    st_x, st_y, st_r = lay.st_x, lay.st_y, lay.st_r
    has_rb = lay.has_rb
    rb_x, rb_y, rb_w, rb_l = lay.rb_x, lay.rb_y, lay.rb_w, lay.rb_l
    eta_x, eta_y = lay.eta_x, lay.eta_y
    trench_centres_y = lay.trench_centres_y
    swale_y, swale_half_w = lay.swale_y, lay.swale_half_w
    veg_y = lay.veg_y
    res_x, res_cy = lay.res_x, lay.res_cy
    n_plants = max(4, min(30, int(tr.trench_length_m)))

    tb_minx = min(-14.0, dw_x - dw_w / 2 - 5.0, eta_x - tr.trench_length_m / 2 - 5.0)
    tb_maxx = max(18.0, dw_x + dw_w / 2 + 5.0, eta_x + tr.trench_length_m / 2 + 8.0)
    tb_miny = min(res_cy - tr.envelope_width_m / 2 - 6.0, dw_y - dw_l / 2 - 6.0)
    tb_maxy = max(dw_y + dw_l / 2 + 5.0, swale_y + 4.0)

    # --- 2. RENDER MATCHING SCALED VECTOR PREVIEW (PNG + PDF) ---
    fig = plt.figure(figsize=(10.5, 8.2), dpi=220)
    ax = fig.add_axes([0.07, 0.19, 0.86, 0.74])
    ax.set_facecolor("#ffffff")

    # Optional parcel boundary overlay when real MGA56 pins align
    for ring in lay.parcel_rings_local:
        rx = [pt[0] for pt in ring] + [ring[0][0]]
        ry = [pt[1] for pt in ring] + [ring[0][1]]
        ax.plot(rx, ry, color="#ef4444", linestyle="--", lw=1.2, alpha=0.8)

    # Dwelling + 3m clearance
    ax.add_patch(Rectangle((dw_x - dw_w / 2 - 3.0, dw_y - dw_l / 2 - 3.0), dw_w + 6.0, dw_l + 6.0, fill=False, edgecolor="#d97706", linestyle="--", lw=1.0, label="3.0 m Building Clearance (Septic)"))
    ax.add_patch(Rectangle((dw_x - dw_w / 2, dw_y - dw_l / 2), dw_w, dw_l, facecolor="#e2e8f0", edgecolor="#0f172a", lw=1.8, hatch="///"))
    ax.text(dw_x, dw_y, "DWELLING\n(All fixtures connected)", ha="center", va="center", fontsize=8.5, fontweight="bold", color="#0f172a", bbox=dict(facecolor="white", edgecolor="none", alpha=0.85, pad=1.5))

    # Septic tank
    ax.add_patch(Circle((st_x, st_y), radius=st_r, facecolor="#fed7aa", edgecolor="#9a3412", lw=1.6))
    ax.plot([st_x - st_r, st_x + st_r], [st_y, st_y], color="#9a3412", lw=1.2)
    ax.text(st_x + 1.4, st_y, f"{model.septic_tank_min_l} L Septic Tank\n(Baffle + Outlet Filter)", ha="left", va="center", fontsize=8, fontweight="bold", color="#7c2d12")
    ax.annotate("", xy=(st_x, st_y + st_r), xytext=(dw_x, dw_y - dw_l / 2), arrowprops=dict(arrowstyle="-|>", color="#dc2626", lw=1.6))

    # Reed bed
    if has_rb:
        ax.add_patch(Rectangle((rb_x - rb_w / 2, rb_y - rb_l / 2), rb_w, rb_l, facecolor="#bbf7d0", edgecolor="#166534", lw=1.6))
        ax.text(
            rb_x + rb_w / 2 + 0.6,
            rb_y,
            f"{model.recommended_reed_bed_count}× {model.recommended_reed_bed_model}\n"
            f"({rb_w:.1f} m × {rb_l:.1f} m = {model.recommended_reed_bed_provided_m2:.1f} m²)\n"
            f"HRT: {model.reed_bed_hrt_days} days  |  N Removal: {model.n_removal_pct:.0f}%",
            ha="left",
            va="center",
            fontsize=7.3,
            fontweight="bold",
            color="#14532d",
        )
        ax.annotate("", xy=(rb_x, rb_y + rb_l / 2), xytext=(st_x, st_y - st_r), arrowprops=dict(arrowstyle="-|>", color="#dc2626", lw=1.6))
        feed_pt = (rb_x, rb_y - rb_l / 2)
    else:
        feed_pt = (st_x, st_y - st_r)

    # Upslope swale
    ax.plot([eta_x - swale_half_w, eta_x - swale_half_w + 1.2, eta_x + swale_half_w - 1.2, eta_x + swale_half_w],
            [swale_y - 0.6, swale_y, swale_y, swale_y - 0.6], color="#0284c7", lw=2.0, linestyle="-.")
    ax.text(eta_x, swale_y + 0.35, "Upslope Stormwater Diversion Swale", ha="center", va="bottom", fontsize=7.5, color="#0369a1", fontweight="bold")

    # ETA Beds / Irrigation Zone
    ax.annotate("", xy=(eta_x, trench_centres_y[0] + tr.trench_width_m / 2), xytext=feed_pt, arrowprops=dict(arrowstyle="-|>", color="#dc2626", lw=1.6))
    for i, ty in enumerate(trench_centres_y):
        ax.add_patch(Rectangle((eta_x - tr.trench_length_m / 2, ty - tr.trench_width_m / 2), tr.trench_length_m, tr.trench_width_m, facecolor="#dbeafe", edgecolor="#1e40af", lw=1.6))
        if not lay.is_irrig:
            ax.plot([eta_x - tr.trench_length_m / 2 + 0.4, eta_x + tr.trench_length_m / 2 - 0.4], [ty, ty], color="#dc2626", lw=1.2, linestyle="--")
        lbl = (
            f"IRRIGATION ZONE: {tr.trench_length_m:.1f} m × {tr.trench_width_m:.1f} m ({model.required_laa_m2:.1f} m²)"
            if lay.is_irrig
            else f"ETA BED {i+1}: {tr.trench_length_m:.1f} m × {tr.trench_width_m:.1f} m\n(Centrally Fed 100 mm Slotted Pipe)"
        )
        ax.text(
            eta_x,
            ty,
            lbl,
            ha="center",
            va="center",
            fontsize=7.1,
            fontweight="bold",
            color="#1e3a8a",
            bbox=dict(facecolor="#eff6ff", edgecolor="none", alpha=0.85, pad=1.0),
        )

    # Vegetation uptake row
    for k in range(n_plants):
        px = eta_x - tr.trench_length_m / 2 + 0.5 + k * max(0.0, tr.trench_length_m - 1.0) / max(1, n_plants - 1)
        ax.add_patch(Circle((px, veg_y), radius=0.28, facecolor="#4ade80", edgecolor="#15803d", lw=0.8))
    ax.text(eta_x, veg_y - 0.6, "Downslope Buffer Planting: Double Row Lomandra hystrix (1.0 m offset)", ha="center", va="top", fontsize=7.2, color="#15803d")

    # Reserve LAA
    ax.add_patch(Rectangle((res_x - tr.trench_length_m / 2, res_cy - tr.envelope_width_m / 2), tr.trench_length_m, tr.envelope_width_m, facecolor="#f1f5f9", edgecolor="#0f766e", lw=1.4, linestyle="--"))
    ax.text(res_x, res_cy, f"NOMINATED 100% ALTERNATE (RESERVE) LAA\n{tr.trench_length_m:.1f} m × {tr.envelope_width_m:.1f} m ({model.reserve_laa_m2:.1f} m²)", ha="center", va="center", fontsize=7.8, fontweight="bold", color="#115e59")

    # Boreholes
    bh_plot_pos = lay.bh_positions if lay.has_real_mga_pins else [
        (eta_x - tr.trench_length_m / 2 - 1.2, trench_centres_y[0] + 0.5),
        (eta_x + tr.trench_length_m / 2 + 1.2, trench_centres_y[-1] - 0.5),
    ]
    for idx, (bx, by) in enumerate(bh_plot_pos):
        ax.plot(bx, by, marker="o", markersize=7, markerfacecolor="#facc15", markeredgecolor="#713f12", lw=1.2, zorder=10)
        ax.text(
            bx,
            by + 0.65,
            f"BH{idx+1}",
            ha="center",
            va="bottom",
            fontsize=7.3,
            fontweight="bold",
            color="#713f12",
            bbox=dict(facecolor="#fef9c3", edgecolor="#ca8a04", lw=0.6, pad=1.2),
            zorder=11,
        )

    # Slope arrow & North indicator
    ax.annotate("", xy=(tb_maxx - 2.2, eta_y - 3.5), xytext=(tb_maxx - 2.2, eta_y + 2.0), arrowprops=dict(arrowstyle="-|>", color="#334155", lw=1.8))
    ax.text(tb_maxx - 2.2, eta_y + 2.4, f"FALL\n{inp.site_eval.slope_pct}%\n({inp.site_eval.aspect})", ha="center", va="bottom", fontsize=7.3, fontweight="bold", color="#334155")

    ax.annotate("", xy=(tb_minx + 2.0, tb_maxy - 1.2), xytext=(tb_minx + 2.0, tb_maxy - 4.2), arrowprops=dict(arrowstyle="-|>", color="#0f172a", lw=2.0))
    ax.text(tb_minx + 2.0, tb_maxy - 0.9, "N", ha="center", va="bottom", fontsize=11, fontweight="bold", color="#0f172a")

    ax.set_xlim(tb_minx, tb_maxx)
    ax.set_ylim(tb_miny + 1.5, tb_maxy)
    ax.set_aspect("equal")
    ax.grid(True, linestyle=":", color="#e2e8f0", linewidth=0.7)
    ax.set_xlabel("Local Easting / Cross-Slope (metres — 1:1 metric scale)", fontsize=8, color="#334155")
    ax.set_ylabel("Local Northing / Downslope Axis (metres)", fontsize=8, color="#334155")
    ax.set_title(
        f"PROPOSED OSSM ENGINEERING LAYOUT PLAN — {inp.site_address} (Lot {inp.lot_number} {inp.plan_label})",
        fontsize=10.5,
        fontweight="bold",
        color="#0f172a",
        pad=10,
    )

    # Title block footer
    tb = fig.add_axes([0.07, 0.03, 0.86, 0.11])
    tb.set_xlim(0, 1)
    tb.set_ylim(0, 1)
    tb.axis("off")
    tb.add_patch(FancyBboxPatch((0, 0), 1, 1, boxstyle="square,pad=0", facecolor="#f8fafc", edgecolor="#0f172a", lw=1.2))
    tb.plot([0.43, 0.43], [0, 1], color="#0f172a", lw=0.8)
    tb.plot([0.73, 0.73], [0, 1], color="#0f172a", lw=0.8)

    tb.text(0.012, 0.75, "SYSTEM SPECIFICATION SUMMARY", fontsize=7.2, fontweight="bold", color="#0f172a")
    tb.text(0.012, 0.46, f"Flow: {model.total_flow_ld:.0f} L/d ({model.design_persons} EP @ {model.flow_rate_lpd:.0f} L/p/d)  |  Septic: {model.septic_tank_min_l} L", fontsize=7.0, color="#1e293b")
    tb.text(0.012, 0.15, f"LAA: {tr.number_of_trenches}× ETA ({tr.trench_length_m:.1f} m × {tr.trench_width_m:.1f} m = {model.required_laa_m2:.1f} m²) + Reserve", fontsize=7.0, color="#1e293b")

    tb.text(0.442, 0.75, "CAD DELIVERABLE & COMPLIANCE", fontsize=7.2, fontweight="bold", color="#0f172a")
    tb.text(0.442, 0.46, "Native AutoCAD DXF (12 Layers, Metric)", fontsize=7.0, color="#1e293b")
    tb.text(0.442, 0.15, "LCC Strategy 2013 & AS/NZS 1547:2012", fontsize=6.9, color="#334155")

    tb.text(0.742, 0.75, "DRAWING CONTROL", fontsize=7.2, fontweight="bold", color="#0f172a")
    tb.text(0.742, 0.46, f"Drawing: OSSM-CAD-01  |  Ref: {inp.project_ref}", fontsize=6.9, color="#1e293b")
    tb.text(0.742, 0.15, f"Date: {inp.site_eval.assessment_date.isoformat()}  |  1:1 Metric Grid", fontsize=7.0, fontweight="bold", color="#991b1b")

    fig.savefig(out_preview_png, dpi=220)
    if out_preview_pdf is not None:
        fig.savefig(out_preview_pdf)
    plt.close(fig)

    return out_dxf, out_preview_png, out_preview_pdf
