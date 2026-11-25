"""Programmatic AutoCAD DXF + Vector Preview generator for Lismore OSSM Site Layout Plans.

Replaces hand-drawn site layout sketches with a deterministic, scaled, multi-layered `.dxf`
(readable natively in AutoCAD, BricsCAD, and QGIS) plus a crisp preview PNG/PDF for embedding
directly into the council Section 68 report.
"""

from __future__ import annotations

import math
from pathlib import Path

import ezdxf
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Circle, FancyBboxPatch, Polygon as MplPolygon, Rectangle

from enviro_comply.schemas.ossm import (
    SiteAssessmentInput,
    TreatmentSystemType,
    WastewaterModelResult,
)


def _add_rect_dxf(msp: ezdxf.layouts.Modelspace, cx: float, cy: float, w: float, h: float, layer: str, hatch_pattern: str | None = None) -> None:
    x0, y0 = cx - w / 2.0, cy - h / 2.0
    pts = [(x0, y0), (x0 + w, y0), (x0 + w, y0 + h), (x0, y0 + h), (x0, y0)]
    msp.add_lwpolyline(pts, dxfattribs={"layer": layer})
    if hatch_pattern:
        hatch = msp.add_hatch(dxfattribs={"layer": layer})
        hatch.set_pattern_fill(hatch_pattern, scale=0.4)
        hatch.paths.add_polyline_path(pts[:-1], is_closed=True)


def generate_ossm_cad_plan(
    inp: SiteAssessmentInput,
    model: WastewaterModelResult,
    out_dxf: Path,
    out_preview_png: Path,
    out_preview_pdf: Path | None = None,
) -> tuple[Path, Path, Path | None]:
    """Generate a layered AutoCAD .dxf site layout plan and matching scaled PNG/PDF preview."""
    out_dxf.parent.mkdir(parents=True, exist_ok=True)
    out_preview_png.parent.mkdir(parents=True, exist_ok=True)

    # Resolve key layout coordinates in local metres (origin = dwelling centre at 0, 0;
    # downslope runs toward -Y for clean engineering readability, rotated visually if needed)
    pins_by_type = {p.feature_type: p for p in inp.field_pins}

    dw_pin = pins_by_type.get("dwelling")
    dw_x, dw_y = (dw_pin.local_x_m, dw_pin.local_y_m) if dw_pin else (0.0, 12.0)
    dw_w = (dw_pin.width_m if dw_pin and dw_pin.width_m else 10.0)
    dw_l = (dw_pin.length_m if dw_pin and dw_pin.length_m else 6.0)

    st_pin = pins_by_type.get("septic_tank")
    st_x, st_y = (st_pin.local_x_m, st_pin.local_y_m) if st_pin else (0.0, dw_y - dw_l / 2.0 - 4.5)
    st_r = 1.0  # ~2.0 m diameter 3000 L cylindrical poly tank

    has_rb = inp.treatment_system == TreatmentSystemType.SECONDARY_REED_BED
    rb_pin = pins_by_type.get("reed_bed")
    rb_x, rb_y = (rb_pin.local_x_m, rb_pin.local_y_m) if rb_pin else (0.0, st_y - 4.0)
    rb_w = 1.9
    rb_l = 3.0 * max(1, model.recommended_reed_bed_count)

    eta_pin = pins_by_type.get("eta_bed")
    tr = model.trench_layout
    eta_x, eta_y = (eta_pin.local_x_m, eta_pin.local_y_m) if eta_pin else (0.0, (rb_y - 5.5) if has_rb else (st_y - 7.0))

    res_pin = pins_by_type.get("reserve_laa")
    res_x, res_y = (res_pin.local_x_m, res_pin.local_y_m) if res_pin else (eta_x, eta_y - tr.envelope_width_m - 4.0)

    # --- 1. BUILD AUTOCAD DXF ---
    doc = ezdxf.new("R2010")
    doc.units = ezdxf.units.M
    msp = doc.modelspace()

    layers = [
        ("1_DWELLING", 7, "CONTINUOUS"),
        ("2_SEPTIC_TANK", 30, "CONTINUOUS"),
        ("3_REED_BED", 3, "CONTINUOUS"),
        ("4_ETA_BED", 5, "CONTINUOUS"),
        ("5_RESERVE_LAA", 4, "DASHED"),
        ("6_PIPES", 1, "CONTINUOUS"),
        ("7_SETBACKS", 2, "DASHED"),
        ("8_DIVERSION_SWALE", 140, "CONTINUOUS"),
        ("9_BOREHOLES", 6, "CONTINUOUS"),
        ("10_VEGETATION", 94, "CONTINUOUS"),
        ("11_ANNOTATIONS", 7, "CONTINUOUS"),
        ("12_TITLE_BLOCK", 7, "CONTINUOUS"),
    ]
    if "DASHED" not in doc.linetypes:
        doc.linetypes.add("DASHED", pattern=[0.6, 0.4, -0.2])
    for name, color, ltype in layers:
        doc.layers.add(name, color=color, linetype=ltype)

    # Dwelling
    _add_rect_dxf(msp, dw_x, dw_y, dw_w, dw_l, "1_DWELLING", hatch_pattern="ANSI31")
    msp.add_text("EXISTING / PROPOSED DWELLING", dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.45}).set_placement((dw_x, dw_y), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)

    # 3m septic clearance envelope around dwelling
    _add_rect_dxf(msp, dw_x, dw_y, dw_w + 6.0, dw_l + 6.0, "7_SETBACKS")

    # Septic Tank
    msp.add_circle((st_x, st_y), radius=st_r, dxfattribs={"layer": "2_SEPTIC_TANK"})
    msp.add_line((st_x - st_r, st_y), (st_x + st_r, st_y), dxfattribs={"layer": "2_SEPTIC_TANK"})
    msp.add_text(f"{model.septic_tank_min_l}L SEPTIC TANK + FILTER", dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.35}).set_placement((st_x + 1.5, st_y), align=ezdxf.enums.TextEntityAlignment.MIDDLE_LEFT)

    # Pipe: Dwelling -> Septic
    msp.add_line((dw_x, dw_y - dw_l / 2.0), (st_x, st_y + st_r), dxfattribs={"layer": "6_PIPES"})

    # Reed Bed (if applicable)
    if has_rb:
        _add_rect_dxf(msp, rb_x, rb_y, rb_w, rb_l, "3_REED_BED", hatch_pattern="GRAVEL")
        msp.add_line((st_x, st_y - st_r), (rb_x, rb_y + rb_l / 2.0), dxfattribs={"layer": "6_PIPES"})
        msp.add_text(
            f"{model.recommended_reed_bed_count}x REED BED TRAY ({rb_w:.1f}m x {rb_l:.1f}m = {model.recommended_reed_bed_provided_m2:.1f}m2)",
            dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.35},
        ).set_placement((rb_x + rb_w / 2.0 + 0.6, rb_y), align=ezdxf.enums.TextEntityAlignment.MIDDLE_LEFT)
        feed_from = (rb_x, rb_y - rb_l / 2.0)
    else:
        feed_from = (st_x, st_y - st_r)

    # ETA Beds (exact number, length, width, 2m separation)
    trench_centres_y: list[float] = []
    start_y = eta_y
    for i in range(tr.number_of_trenches):
        ty = start_y - i * (tr.trench_width_m + tr.trench_separation_m)
        trench_centres_y.append(ty)
        _add_rect_dxf(msp, eta_x, ty, tr.trench_length_m, tr.trench_width_m, "4_ETA_BED", hatch_pattern="ANSI37")
        # Central 100mm slotted distribution pipe
        msp.add_line(
            (eta_x - tr.trench_length_m / 2.0 + 0.5, ty),
            (eta_x + tr.trench_length_m / 2.0 - 0.5, ty),
            dxfattribs={"layer": "6_PIPES"},
        )
        msp.add_text(
            f"ETA BED {i+1}: {tr.trench_length_m:.1f}m x {tr.trench_width_m:.1f}m x {int(inp.root_zone_depth_mm + inp.gravel_depth_mm)}mm",
            dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.35},
        ).set_placement((eta_x + tr.trench_length_m / 2.0 + 0.6, ty), align=ezdxf.enums.TextEntityAlignment.MIDDLE_LEFT)

    # Feed line from Reed Bed / Septic to ETA Bed central feed
    msp.add_line(feed_from, (eta_x, trench_centres_y[0] + tr.trench_width_m / 2.0), dxfattribs={"layer": "6_PIPES"})

    # Upslope Diversion Swale above ETA bed
    swale_y = trench_centres_y[0] + tr.trench_width_m / 2.0 + 1.5
    swale_half_w = tr.trench_length_m / 2.0 + 2.0
    msp.add_lwpolyline(
        [(eta_x - swale_half_w, swale_y - 0.6), (eta_x - swale_half_w + 1.2, swale_y), (eta_x + swale_half_w - 1.2, swale_y), (eta_x + swale_half_w, swale_y - 0.6)],
        dxfattribs={"layer": "8_DIVERSION_SWALE"},
    )
    msp.add_text("UPSLOPE RUN-ON DIVERSION SWALE", dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.30}).set_placement((eta_x, swale_y + 0.45), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)

    # Downslope Lomandra uptake planting row
    veg_y = trench_centres_y[-1] - tr.trench_width_m / 2.0 - 1.2
    n_plants = max(4, int(tr.trench_length_m))
    for k in range(n_plants):
        px = eta_x - tr.trench_length_m / 2.0 + 0.5 + k * (tr.trench_length_m - 1.0) / max(1, n_plants - 1)
        msp.add_circle((px, veg_y), radius=0.25, dxfattribs={"layer": "10_VEGETATION"})
    msp.add_text("DOUBLE ROW LOMANDRA HYSTRIX (1m OFFSET)", dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.28}).set_placement((eta_x, veg_y - 0.65), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)

    # Reserve LAA (100% alternate area)
    res_top_y = veg_y - 2.6
    _add_rect_dxf(msp, res_x, res_top_y - tr.envelope_width_m / 2.0, tr.trench_length_m, tr.envelope_width_m, "5_RESERVE_LAA")
    msp.add_text(
        f"NOMINATED 100% RESERVE LAA ({model.reserve_laa_m2:.1f} m2)",
        dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.35},
    ).set_placement((res_x, res_top_y - tr.envelope_width_m / 2.0), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)

    # Borehole locations
    bh_positions = [
        (eta_x - tr.trench_length_m / 2.0 + 1.5, trench_centres_y[0] + 0.3),
        (eta_x + tr.trench_length_m / 2.0 - 1.5, trench_centres_y[-1] - 0.3),
    ]
    for idx, (bx, by) in enumerate(bh_positions[: max(2, len(inp.boreholes))]):
        msp.add_circle((bx, by), radius=0.32, dxfattribs={"layer": "9_BOREHOLES"})
        msp.add_line((bx - 0.32, by), (bx + 0.32, by), dxfattribs={"layer": "9_BOREHOLES"})
        msp.add_line((bx, by - 0.32), (bx, by + 0.32), dxfattribs={"layer": "9_BOREHOLES"})
        msp.add_text(f"BH{idx+1}", dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.30}).set_placement((bx + 0.45, by + 0.35))

    # DXF Title Block border
    tb_minx, tb_maxx = -14.0, 18.0
    tb_miny, tb_maxy = res_top_y - tr.envelope_width_m - 6.0, dw_y + dw_l / 2.0 + 5.0
    msp.add_lwpolyline([(tb_minx, tb_miny), (tb_maxx, tb_miny), (tb_maxx, tb_maxy), (tb_minx, tb_maxy), (tb_minx, tb_miny)], dxfattribs={"layer": "12_TITLE_BLOCK"})
    msp.add_text(
        f"OSSM LAYOUT PLAN | {inp.site_address} (Lot {inp.lot_number} {inp.plan_label}) | Applicant: {inp.applicant_name} | Ref: {inp.project_ref}",
        dxfattribs={"layer": "12_TITLE_BLOCK", "height": 0.42},
    ).set_placement((tb_minx + 0.6, tb_miny + 1.0))

    doc.saveas(str(out_dxf))

    # --- 2. RENDER MATCHING SCALED VECTOR PREVIEW (PNG + PDF) ---
    fig = plt.figure(figsize=(10.5, 8.2), dpi=220)
    ax = fig.add_axes([0.07, 0.19, 0.86, 0.74])
    ax.set_facecolor("#ffffff")

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

    # ETA Beds
    ax.annotate("", xy=(eta_x, trench_centres_y[0] + tr.trench_width_m / 2), xytext=feed_pt, arrowprops=dict(arrowstyle="-|>", color="#dc2626", lw=1.6))
    for i, ty in enumerate(trench_centres_y):
        ax.add_patch(Rectangle((eta_x - tr.trench_length_m / 2, ty - tr.trench_width_m / 2), tr.trench_length_m, tr.trench_width_m, facecolor="#dbeafe", edgecolor="#1e40af", lw=1.6))
        ax.plot([eta_x - tr.trench_length_m / 2 + 0.4, eta_x + tr.trench_length_m / 2 - 0.4], [ty, ty], color="#dc2626", lw=1.2, linestyle="--")
        ax.text(
            eta_x,
            ty,
            f"ETA BED {i+1}: {tr.trench_length_m:.1f} m × {tr.trench_width_m:.1f} m\n(Centrally Fed 100 mm Slotted Pipe)",
            ha="center",
            va="center",
            fontsize=7.1,
            fontweight="bold",
            color="#1e3a8a",
            bbox=dict(facecolor="#eff6ff", edgecolor="none", alpha=0.85, pad=1.0),
        )

    # Vegetation uptake row
    for k in range(n_plants):
        px = eta_x - tr.trench_length_m / 2 + 0.5 + k * (tr.trench_length_m - 1.0) / max(1, n_plants - 1)
        ax.add_patch(Circle((px, veg_y), radius=0.28, facecolor="#4ade80", edgecolor="#15803d", lw=0.8))
    ax.text(eta_x, veg_y - 0.6, "Downslope Buffer Planting: Double Row Lomandra hystrix (1.0 m offset)", ha="center", va="top", fontsize=7.2, color="#15803d")

    # Reserve LAA
    res_cy = res_top_y - tr.envelope_width_m / 2
    ax.add_patch(Rectangle((res_x - tr.trench_length_m / 2, res_cy - tr.envelope_width_m / 2), tr.trench_length_m, tr.envelope_width_m, facecolor="#f1f5f9", edgecolor="#0f766e", lw=1.4, linestyle="--"))
    ax.text(res_x, res_cy, f"NOMINATED 100% ALTERNATE (RESERVE) LAA\n{tr.trench_length_m:.1f} m × {tr.envelope_width_m:.1f} m ({model.reserve_laa_m2:.1f} m²)", ha="center", va="center", fontsize=7.8, fontweight="bold", color="#115e59")

    # Boreholes (placed cleanly at opposite corners outside bed label)
    bh_plot_pos = [
        (eta_x - tr.trench_length_m / 2 - 1.2, trench_centres_y[0] + 0.5),
        (eta_x + tr.trench_length_m / 2 + 1.2, trench_centres_y[-1] - 0.5),
    ]
    for idx, (bx, by) in enumerate(bh_plot_pos[: max(2, len(inp.boreholes))]):
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
