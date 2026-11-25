"""Programmatic matplotlib engineering cross-section & treatment-train renderers for Python CLI.

Generates high-DPI PNG drawings with live project dimensions matching the browser SVG renderers:
  - treatment_train: Cover-page flow schematic
  - septic_xsec: Baffled septic tank with external effluent filter (AS/NZS 1546.1)
  - reed_bed_xsec: Rigid sub-surface flow reed bed elevation & gravel/water-level section
  - laa_xsec: ETA Bed Cross-Section (LCC Design 1) OR Sub-Surface Drip Irrigation Cross-Section
"""

from __future__ import annotations

from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.patches as patches
import matplotlib.pyplot as plt

from enviro_comply.schemas.ossm import (
    ComplianceAuditResult,
    LandApplicationType,
    SiteAssessmentInput,
    TreatmentSystemType,
    WastewaterModelResult,
)


def render_treatment_train_png(inp: SiteAssessmentInput, model: WastewaterModelResult, out_png: Path) -> Path:
    has_rb = inp.treatment_system == TreatmentSystemType.SECONDARY_REED_BED
    is_awts = inp.treatment_system == TreatmentSystemType.SECONDARY_AWTS
    is_irrig = inp.land_application_type != LandApplicationType.ETA_BEDS
    tr = model.trench_layout

    src_title = "MULTI-USE SOURCES" if model.source_breakdown else "SOURCE"
    src_sub = (
        f"{len(model.source_breakdown)} Sources ({model.design_persons} EP)"
        if model.source_breakdown
        else f"{inp.bedrooms} BR ({model.design_persons} EP)"
    )
    steps = [
        (src_title, src_sub, f"{model.total_flow_ld:.0f} L/day (BOD {model.weighted_influent_bod_mgl:.0f})", "#f1f5f9", "#334155"),
    ]
    if model.grease_arrestor_min_l > 0:
        steps.append((
            "GREASE ARRESTOR",
            f"{model.grease_arrestor_min_l} L Trap",
            "AS/NZS 3500.2 FOG Capture",
            "#fef3c7",
            "#b45309",
        ))
    steps.append(
        ("SECONDARY AWTS", "NSW Health Accredited", "Aeration + Disinfection", "#fed7aa", "#9a3412")
        if is_awts
        else ("PRIMARY SEPTIC", f"{model.septic_tank_min_l} L Tank", f"Baffle + Filter ({model.septic_retention_days:.1f} d)", "#fed7aa", "#9a3412")
    )
    if model.surge_tank_min_l > 0:
        steps.append((
            "BALANCE TANK",
            f"{model.surge_tank_min_l} L Surge",
            "Time-Dosed Equalisation",
            "#ede9fe",
            "#6d28d9",
        ))
    if has_rb:
        steps.append((
            "SECONDARY REED BED",
            f"{model.recommended_reed_bed_count}× Rigid Tub ({model.recommended_reed_bed_provided_m2:.1f} m²)",
            f"HRT {model.reed_bed_hrt_days:.1f} d · {model.n_removal_pct:.0f}% N Rem.",
            "#bbf7d0",
            "#166534",
        ))
    if is_irrig:
        steps.append(("PUMP WELL", "1,800 L + Alarm", "Disc Filter + Index Valve", "#e0f2fe", "#0369a1"))
    steps.append((
        "IRRIGATION ZONE" if is_irrig else "ETA DISPOSAL FIELD",
        f"{tr.trench_length_m:.1f} m × {tr.trench_width_m:.1f} m ({model.required_laa_m2:.1f} m²)"
        if is_irrig
        else f"{tr.number_of_trenches}× Bed {tr.trench_length_m:.1f} m × {tr.trench_width_m:.1f} m",
        f"+ 100% Reserve ({model.reserve_laa_m2:.1f} m²)",
        "#dbeafe",
        "#1e40af",
    ))

    n = len(steps)
    fig, ax = plt.subplots(figsize=(2.4 * n, 1.45), dpi=200)
    ax.set_xlim(0, n * 2.4)
    ax.set_ylim(0, 1.4)
    ax.axis("off")

    bw = 2.0
    gap = 0.38
    for i, (title, sub, detail, fc, ec) in enumerate(steps):
        x = 0.1 + i * (bw + gap)
        rect = patches.FancyBboxPatch(
            (x, 0.2), bw, 1.0, boxstyle="round,pad=0.04,rounding_size=0.12",
            facecolor=fc, edgecolor=ec, linewidth=1.8,
        )
        ax.add_patch(rect)
        ax.text(x + bw / 2, 0.96, title, ha="center", va="center", fontsize=8.2, fontweight="bold", color=ec)
        ax.text(x + bw / 2, 0.65, sub, ha="center", va="center", fontsize=7.6, fontweight="bold", color="#0f172a")
        ax.text(x + bw / 2, 0.38, detail, ha="center", va="center", fontsize=7.0, color="#475569")
        if i < n - 1:
            ax.annotate(
                "", xy=(x + bw + gap - 0.03, 0.7), xytext=(x + bw + 0.03, 0.7),
                arrowprops=dict(arrowstyle="->,head_width=0.25,head_length=0.25", color="#143628", lw=2.0),
            )

    fig.tight_layout(pad=0.15)
    fig.savefig(out_png, dpi=200, facecolor="white")
    plt.close(fig)
    return out_png


def render_septic_xsec_png(model: WastewaterModelResult, out_png: Path) -> Path:
    fig, ax = plt.subplots(figsize=(8.2, 4.2), dpi=200)
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 5.4)
    ax.axis("off")

    ax.text(5.0, 5.15, f"TYPICAL CROSS-SECTION — {model.septic_tank_min_l} L BAFFLED SEPTIC TANK WITH EFFLUENT FILTER", ha="center", fontsize=10.5, fontweight="bold", color="#0d241b")
    ax.text(5.0, 4.85, f"AS/NZS 1546.1 & Lismore CC OSSM Strategy (2013) Appendix A · Retention: {model.septic_retention_days:.1f} days @ {model.total_flow_ld:.0f} L/d", ha="center", fontsize=8.2, color="#475569")

    # Ground surface & backfill
    ax.add_patch(patches.Rectangle((0.3, 0.45), 9.4, 3.35, facecolor="#f5f0e6", edgecolor="none"))
    ax.plot([0.3, 9.7], [3.8, 3.8], color="#3f6212", lw=2.2)
    ax.text(0.45, 3.92, "Finished Ground Level (Divert Stormwater)", fontsize=7.5, fontweight="bold", color="#3f6212")

    # Crusher dust base
    ax.add_patch(patches.Rectangle((1.6, 0.45), 6.8, 0.3, facecolor="#cbd5e1", edgecolor="#64748b", lw=1.0, hatch="..."))
    ax.text(5.0, 0.25, "100 mm Compacted Level Crusher-Dust Bedding Pad", ha="center", fontsize=7.5, fontweight="bold", color="#334155")

    # Tank shell
    ax.add_patch(patches.Rectangle((1.8, 0.75), 6.4, 2.75, facecolor="#ffffff", edgecolor="#334155", lw=2.5))
    # Risers
    ax.add_patch(patches.Rectangle((2.5, 3.5), 1.0, 0.42, facecolor="#e2e8f0", edgecolor="#334155", lw=1.6))
    ax.add_patch(patches.Rectangle((6.5, 3.5), 1.0, 0.42, facecolor="#e2e8f0", edgecolor="#334155", lw=1.6))
    ax.text(3.0, 4.05, "Inlet Access\nLid (Flush)", ha="center", fontsize=7.2, fontweight="bold", color="#1e293b")
    ax.text(7.0, 4.05, "Outlet Filter\nAccess Riser", ha="center", fontsize=7.2, fontweight="bold", color="#1e293b")

    # Liquid zones: sludge, clear liquid, scum
    ax.add_patch(patches.Rectangle((1.85, 0.8), 6.3, 0.65, facecolor="#78350f", alpha=0.85))
    ax.add_patch(patches.Rectangle((1.85, 1.45), 6.3, 1.35, facecolor="#bae6fd", alpha=0.75))
    ax.add_patch(patches.Rectangle((1.85, 2.8), 6.3, 0.22, facecolor="#d97706", alpha=0.75))

    ax.text(3.4, 1.12, "Settled Sludge Layer (Pump out @ 1/3 depth)", ha="center", fontsize=7.3, fontweight="bold", color="white")
    ax.text(3.4, 2.1, "Primary Chamber (Anaerobic Digestion)", ha="center", fontsize=7.8, fontweight="bold", color="#0c4a6e")
    ax.text(3.4, 2.91, "Floating Scum Mat", ha="center", fontsize=7.0, fontweight="bold", color="#78350f")

    # Internal baffle wall
    ax.add_patch(patches.Rectangle((5.45, 1.35), 0.14, 1.9, facecolor="#334155", edgecolor="#1e293b"))
    ax.text(5.52, 3.32, "Internal Baffle", ha="center", fontsize=7.2, fontweight="bold", color="#1e293b")

    # Inlet & outlet pipes + T-squares + Effluent Filter
    ax.add_patch(patches.Rectangle((0.6, 2.95), 1.7, 0.18, facecolor="#94a3b8", edgecolor="#1e293b", lw=1.2))
    ax.add_patch(patches.Rectangle((2.15, 2.2), 0.18, 1.15, facecolor="#94a3b8", edgecolor="#1e293b", lw=1.2))
    ax.text(1.15, 3.25, "100 mm uPVC\nInlet from House", ha="center", fontsize=7.2, fontweight="bold", color="#1e293b")

    ax.add_patch(patches.Rectangle((6.85, 1.95), 0.42, 1.15, facecolor="#22c55e", edgecolor="#14532d", lw=1.5, hatch="///"))
    ax.add_patch(patches.Rectangle((7.27, 2.75), 2.1, 0.18, facecolor="#38bdf8", edgecolor="#0369a1", lw=1.2))
    ax.text(6.95, 1.72, "External Effluent\nFilter (Biotube/Zabel)", ha="center", fontsize=7.2, fontweight="bold", color="#14532d")
    ax.text(8.8, 3.05, "100 mm Outlet\nto Secondary/LAA", ha="center", fontsize=7.2, fontweight="bold", color="#0369a1")

    fig.tight_layout(pad=0.15)
    fig.savefig(out_png, dpi=200, facecolor="white")
    plt.close(fig)
    return out_png


def render_reed_bed_xsec_png(inp: SiteAssessmentInput, model: WastewaterModelResult, out_png: Path) -> Path:
    fig, ax = plt.subplots(figsize=(8.2, 4.3), dpi=200)
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 5.5)
    ax.axis("off")

    ax.text(5.0, 5.25, f"RIGID REED BED ELEVATION CROSS-SECTION — {model.recommended_reed_bed_count}× {model.recommended_reed_bed_model}", ha="center", fontsize=10.2, fontweight="bold", color="#0d241b")
    ax.text(5.0, 4.95, f"Provided Area: {model.recommended_reed_bed_provided_m2:.1f} m² (Req: {model.reed_bed_required_m2:.1f} m²) · Wetted Depth: {inp.reed_bed_wetted_depth_m:.2f} m · HRT: {model.reed_bed_hrt_days:.1f} d · N Rem: {model.n_removal_pct:.0f}%", ha="center", fontsize=8.0, color="#475569")

    # Surrounding ground + crusher dust
    ax.add_patch(patches.Rectangle((0.3, 0.55), 9.4, 2.65, facecolor="#f5f0e6", edgecolor="none"))
    ax.plot([0.3, 1.5], [3.2, 3.2], color="#3f6212", lw=2.0)
    ax.plot([8.5, 9.7], [3.2, 3.2], color="#3f6212", lw=2.0)
    ax.add_patch(patches.Rectangle((1.35, 0.55), 7.3, 0.25, facecolor="#cbd5e1", edgecolor="#64748b", hatch="..."))
    ax.text(5.0, 0.3, "75–100 mm Compacted Crusher-Dust Base · Rigid Impermeable Tub (No Flexible Liners)", ha="center", fontsize=7.5, fontweight="bold", color="#334155")

    # Tub rim >= 100mm proud
    ax.add_patch(patches.Rectangle((1.5, 0.8), 7.0, 2.75, facecolor="#e2e8f0", edgecolor="#1e293b", lw=2.6))
    ax.text(1.05, 3.45, "Rim >= 100 mm\nAbove Ground", ha="center", fontsize=7.0, fontweight="bold", color="#9a3412")

    # Wetted gravel zone + dry freeboard gravel
    ax.add_patch(patches.Rectangle((1.55, 0.85), 6.9, 2.25, facecolor="#bfdbfe", alpha=0.85, hatch="oo", edgecolor="#64748b"))
    ax.add_patch(patches.Rectangle((1.55, 3.1), 6.9, 0.35, facecolor="#d6d3d1", alpha=0.95, hatch="..", edgecolor="#78716c"))
    ax.plot([1.55, 8.45], [3.1, 3.1], color="#1d4ed8", lw=2.0, linestyle="--")
    ax.text(5.0, 3.27, "50–100 mm Dry Top Gravel (Zero Exposed Effluent)", ha="center", fontsize=7.2, fontweight="bold", color="#44403c")
    ax.text(5.0, 1.95, f"Clean Washed 20 mm Aggregate (Porosity 0.40)\nWetted Depth = {inp.reed_bed_wetted_depth_m:.2f} m", ha="center", fontsize=8.2, fontweight="bold", color="#1e3a8a")

    # Inlet & outlet coarse rock zones
    ax.add_patch(patches.Rectangle((1.55, 0.85), 0.95, 2.6, facecolor="#a8a29e", alpha=0.75, hatch="OO", edgecolor="#57534e"))
    ax.add_patch(patches.Rectangle((7.5, 0.85), 0.95, 2.6, facecolor="#a8a29e", alpha=0.75, hatch="OO", edgecolor="#57534e"))
    ax.text(2.02, 1.25, "50–100 mm\nRock", ha="center", fontsize=6.6, fontweight="bold", color="#1c1917")
    ax.text(7.98, 1.25, "50–100 mm\nRock", ha="center", fontsize=6.6, fontweight="bold", color="#1c1917")

    # Inlet spreader & outlet standpipe tower
    ax.add_patch(patches.Rectangle((0.5, 3.12), 1.55, 0.16, facecolor="#94a3b8", edgecolor="#1e293b"))
    ax.text(0.9, 2.85, "100 mm Inlet\nfrom Septic", ha="center", fontsize=7.0, fontweight="bold", color="#1e293b")
    ax.add_patch(patches.Rectangle((7.78, 0.9), 0.38, 2.8, facecolor="#f8fafc", edgecolor="#0369a1", lw=1.6))
    ax.add_patch(patches.Rectangle((8.16, 2.88), 1.35, 0.16, facecolor="#38bdf8", edgecolor="#0369a1"))
    ax.text(8.95, 2.6, "100 mm Outlet\nto Disposal LAA", ha="center", fontsize=7.0, fontweight="bold", color="#0369a1")
    ax.text(7.95, 3.85, "150 mm PVC Outlet\nControl Standpipe", ha="center", fontsize=7.0, fontweight="bold", color="#0369a1")

    # Native reeds
    for rx in [2.7, 3.5, 4.3, 5.1, 5.9, 6.7, 7.2]:
        for dx, dy in [(-0.14, 0.85), (0.0, 1.05), (0.14, 0.8)]:
            ax.plot([rx, rx + dx], [3.45, 3.45 + dy], color="#15803d", lw=2.0)
    ax.text(5.0, 4.62, "Native Macrophytes @ >= 4–5 plants/m² (Lomandra hystrix, Schoenoplectus validus, Baumea articulata)", ha="center", fontsize=7.5, fontweight="bold", color="#166534")

    fig.tight_layout(pad=0.15)
    fig.savefig(out_png, dpi=200, facecolor="white")
    plt.close(fig)
    return out_png


def render_eta_xsec_png(inp: SiteAssessmentInput, model: WastewaterModelResult, audit: ComplianceAuditResult, out_png: Path) -> Path:
    tr = model.trench_layout
    total_mm = int(inp.root_zone_depth_mm + inp.gravel_depth_mm)
    fig, ax = plt.subplots(figsize=(8.2, 4.2), dpi=200)
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 5.4)
    ax.axis("off")

    ax.text(5.0, 5.15, f"TYPICAL ETA BED CROSS-SECTION (LCC STRATEGY DESIGN 1 — {tr.trench_width_m:.1f} m WIDE × {total_mm} mm DEEP)", ha="center", fontsize=10.2, fontweight="bold", color="#0d241b")
    ax.text(5.0, 4.85, f"{tr.number_of_trenches}× Bed(s) {tr.trench_length_m:.1f} m × {tr.trench_width_m:.1f} m ({model.required_laa_m2:.1f} m² LAA) · Separation >= {tr.trench_separation_m:.1f} m · Actual DLR {model.daily_loading_rate_actual_mmd:.1f} mm/d", ha="center", fontsize=8.0, color="#475569")

    # Natural soil background
    ax.add_patch(patches.Rectangle((0.3, 0.45), 9.4, 2.95, facecolor="#efe7db", edgecolor="none"))
    ax.plot([0.3, 2.2], [3.4, 3.4], color="#3f6212", lw=2.0)
    ax.plot([7.8, 9.7], [3.4, 3.4], color="#3f6212", lw=2.0)

    # Excavated ETA bed
    # Gravel layer
    ax.add_patch(patches.Rectangle((2.2, 1.05), 5.6, 1.35, facecolor="#cbd5e1", edgecolor="#475569", lw=1.6, hatch="oo"))
    # Geotextile
    ax.plot([2.2, 7.8], [2.4, 2.4], color="#dc2626", lw=2.2, linestyle="--")
    # Topsoil + slight mound
    poly = patches.Polygon([[2.2, 2.4], [7.8, 2.4], [7.8, 3.4], [5.0, 3.72], [2.2, 3.4]], facecolor="#a16207", alpha=0.55, edgecolor="#713f12", lw=1.5)
    ax.add_patch(poly)
    ax.plot([2.2, 5.0, 7.8], [3.4, 3.72, 3.4], color="#15803d", lw=2.4)

    # 100 mm slotted PVC pipe centrally fed (NO SOCK)
    pipe = patches.Circle((5.0, 2.18), 0.22, facecolor="#ffffff", edgecolor="#1e3a8a", lw=2.2)
    ax.add_patch(pipe)
    ax.text(5.0, 2.18, "100", ha="center", va="center", fontsize=6.5, fontweight="bold", color="#1e3a8a")

    # Gypsum line if dispersive
    if audit.requires_gypsum:
        ax.plot([2.2, 7.8], [1.05, 1.05], color="#d97706", lw=3.2)
        ax.text(5.0, 0.72, f"Ripped Level Clay Base + Agricultural Gypsum @ {audit.gypsum_rate_kg_m2:.1f} kg/m² (Emerson Class 3/4)", ha="center", fontsize=7.6, fontweight="bold", color="#92400e")
    else:
        ax.text(5.0, 0.72, "Ripped / Scarified Dead-Level Natural Soil Base (Check with Laser Level)", ha="center", fontsize=7.6, fontweight="bold", color="#334155")

    # Callout labels
    ax.text(5.0, 3.92, f"Mounded Perennial Grass Turf ({int(inp.root_zone_depth_mm)} mm Friable Topsoil — Sheds Rain)", ha="center", fontsize=7.8, fontweight="bold", color="#166534")
    ax.text(5.0, 1.55, f"{int(inp.gravel_depth_mm)} mm Clean Washed 20–50 mm Aggregate / Blue Metal", ha="center", fontsize=7.8, fontweight="bold", color="#1e293b")
    ax.annotate("Geotextile Matting\n(Over Gravel Only)", xy=(7.5, 2.4), xytext=(8.7, 2.55), ha="center", fontsize=7.0, fontweight="bold", color="#b91c1c", arrowprops=dict(arrowstyle="->", color="#b91c1c"))
    ax.annotate("100 mm Slotted PVC\n(NO Geotextile Sock)", xy=(5.22, 2.18), xytext=(8.7, 1.72), ha="center", fontsize=7.0, fontweight="bold", color="#1e3a8a", arrowprops=dict(arrowstyle="->", color="#1e3a8a"))

    # Width dimension arrow
    ax.annotate("", xy=(2.2, 4.35), xytext=(7.8, 4.35), arrowprops=dict(arrowstyle="<->", color="#0d241b", lw=1.6))
    ax.text(5.0, 4.46, f"Bed Width = {tr.trench_width_m:.1f} m (Total Excavated Depth = {total_mm} mm)", ha="center", fontsize=8.0, fontweight="bold", color="#0d241b")

    fig.tight_layout(pad=0.15)
    fig.savefig(out_png, dpi=200, facecolor="white")
    plt.close(fig)
    return out_png


def render_sdi_xsec_png(inp: SiteAssessmentInput, model: WastewaterModelResult, out_png: Path) -> Path:
    tr = model.trench_layout
    fig, ax = plt.subplots(figsize=(8.2, 4.2), dpi=200)
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 5.4)
    ax.axis("off")

    ax.text(5.0, 5.15, f"SUB-SURFACE DRIP IRRIGATION CROSS-SECTION — {tr.trench_length_m:.1f} m × {tr.trench_width_m:.1f} m CONTIGUOUS ZONE", ha="center", fontsize=10.0, fontweight="bold", color="#0d241b")
    ax.text(5.0, 4.85, f"Required LAA: {model.required_laa_m2:.1f} m² · ~{round(model.required_laa_m2)} m Dripperline @ 1.0 m Centres · 1,800 L Pump Well · DIR {model.max_deep_drainage_mmd:.1f} mm/d", ha="center", fontsize=8.0, color="#475569")

    # Soil layers
    ax.add_patch(patches.Rectangle((0.4, 0.5), 9.2, 1.85, facecolor="#e7dcc9", edgecolor="none"))
    ax.add_patch(patches.Rectangle((0.4, 2.35), 9.2, 1.25, facecolor="#c7a97e", alpha=0.65, edgecolor="none"))
    ax.plot([0.4, 9.6], [3.6, 3.6], color="#15803d", lw=2.5)
    ax.text(5.0, 3.82, "Maintained Perennial Grass Cover (Vehicles & Livestock Excluded · Reclaimed Water Sign)", ha="center", fontsize=7.8, fontweight="bold", color="#166534")

    # Drip laterals at 1.0 m spacing buried 100-150 mm
    for lx in [1.6, 3.3, 5.0, 6.7, 8.4]:
        ax.add_patch(patches.Circle((lx, 3.05), 0.14, facecolor="#7e22ce", edgecolor="#4c1d95", lw=1.4))
        ax.add_patch(patches.Ellipse((lx, 2.65), 1.15, 0.72, facecolor="#38bdf8", alpha=0.28, edgecolor="#0284c7", linestyle="--"))

    ax.annotate("", xy=(3.3, 4.25), xytext=(5.0, 4.25), arrowprops=dict(arrowstyle="<->", color="#4c1d95", lw=1.6))
    ax.text(4.15, 4.38, "1.0 m Lateral Spacing", ha="center", fontsize=7.8, fontweight="bold", color="#4c1d95")
    ax.text(5.0, 1.45, "Purple Root-Guard Pressure-Compensating Dripperlines (100–150 mm Burial Depth)\nFed via 1,800 L Pump Well + 120-Mesh Disc Filter + Indexing Valve + Air Release + Flush Valves (>= 0.8 m/s)\nRequires Certified Irrigation Design Plan (CIDP — LCC Strategy Appendix C & D)", ha="center", fontsize=7.8, fontweight="bold", color="#1e293b")

    fig.tight_layout(pad=0.15)
    fig.savefig(out_png, dpi=200, facecolor="white")
    plt.close(fig)
    return out_png


def render_grease_arrestor_xsec_png(model: WastewaterModelResult, out_png: Path) -> Path:
    fig, ax = plt.subplots(figsize=(8.2, 4.1), dpi=200)
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 5.4)
    ax.axis("off")

    ax.text(5.0, 5.15, f"TYPICAL CROSS-SECTION — {model.grease_arrestor_min_l} L COMMERCIAL GREASE ARRESTOR (AS/NZS 3500.2)", ha="center", fontsize=10.0, fontweight="bold", color="#0d241b")
    ax.text(5.0, 4.85, "Pre-Treatment Upstream of Primary Septic / Secondary System · Licensed Liquid Waste Pump-Out Every 3–6 Months", ha="center", fontsize=8.0, color="#475569")

    # Ground + bedding
    ax.add_patch(patches.Rectangle((0.3, 0.45), 9.4, 3.25, facecolor="#f5f0e6", edgecolor="none"))
    ax.plot([0.3, 9.7], [3.7, 3.7], color="#3f6212", lw=2.0)
    ax.add_patch(patches.Rectangle((1.5, 0.45), 7.0, 0.28, facecolor="#cbd5e1", edgecolor="#64748b", hatch="..."))
    ax.text(5.0, 0.24, "100 mm Compacted Level Crusher-Dust / Concrete Bedding · Accessible for Vacuum Tanker", ha="center", fontsize=7.4, fontweight="bold", color="#334155")

    # Tank body + airtight gas-tight lid
    ax.add_patch(patches.Rectangle((1.7, 0.73), 6.6, 2.85, facecolor="#ffffff", edgecolor="#334155", lw=2.5))
    ax.add_patch(patches.Rectangle((1.65, 3.58), 6.7, 0.18, facecolor="#64748b", edgecolor="#1e293b", lw=1.4))
    ax.text(5.0, 3.92, "Trafficable Gas-Tight Lockable Access Cover (Flush with Finished Surface)", ha="center", fontsize=7.4, fontweight="bold", color="#1e293b")

    # Settled food solids, clear wastewater, trapped FOG grease crust
    ax.add_patch(patches.Rectangle((1.75, 0.78), 6.5, 0.55, facecolor="#78350f", alpha=0.82))
    ax.add_patch(patches.Rectangle((1.75, 1.33), 6.5, 1.15, facecolor="#bae6fd", alpha=0.75))
    ax.add_patch(patches.Rectangle((1.75, 2.48), 5.1, 0.52, facecolor="#f59e0b", alpha=0.85))

    ax.text(4.3, 1.04, "Settled Food Solids Sump (Remove via Tanker)", ha="center", fontsize=7.2, fontweight="bold", color="white")
    ax.text(4.3, 1.9, "Clarified Middle Aqueous Zone (Submerged Flow)", ha="center", fontsize=7.5, fontweight="bold", color="#0c4a6e")
    ax.text(4.3, 2.74, "Trapped Fats, Oils & Grease (FOG) Retention Layer", ha="center", fontsize=7.5, fontweight="bold", color="#451a03")

    # Internal baffle + submerged outlet tee
    ax.add_patch(patches.Rectangle((6.82, 1.18), 0.14, 2.25, facecolor="#334155"))
    ax.add_patch(patches.Rectangle((0.5, 2.95), 1.65, 0.16, facecolor="#94a3b8", edgecolor="#1e293b"))
    ax.add_patch(patches.Rectangle((2.0, 2.15), 0.16, 1.15, facecolor="#94a3b8", edgecolor="#1e293b"))
    ax.text(1.05, 3.25, "100 mm Inlet from\nCommercial Kitchen", ha="center", fontsize=7.1, fontweight="bold", color="#9a3412")

    ax.add_patch(patches.Rectangle((7.35, 1.45), 0.16, 1.65, facecolor="#38bdf8", edgecolor="#0369a1"))
    ax.add_patch(patches.Rectangle((7.51, 2.75), 1.95, 0.16, facecolor="#38bdf8", edgecolor="#0369a1"))
    ax.text(8.9, 3.05, "100 mm Outlet\nto Primary Septic", ha="center", fontsize=7.1, fontweight="bold", color="#0369a1")

    fig.tight_layout(pad=0.15)
    fig.savefig(out_png, dpi=200, facecolor="white")
    plt.close(fig)
    return out_png


def generate_all_report_diagrams(
    inp: SiteAssessmentInput,
    model: WastewaterModelResult,
    audit: ComplianceAuditResult,
    output_dir: Path,
    slug: str,
) -> dict[str, Path]:
    """Generate all applicable programmatic engineering diagrams for the report."""
    output_dir.mkdir(parents=True, exist_ok=True)
    out: dict[str, Path] = {}
    out["treatment_train"] = render_treatment_train_png(inp, model, output_dir / f"{slug}_Treatment_Train.png")
    if model.grease_arrestor_min_l > 0:
        out["grease_xsec"] = render_grease_arrestor_xsec_png(model, output_dir / f"{slug}_Grease_Arrestor_XSec.png")
    if inp.treatment_system != TreatmentSystemType.SECONDARY_AWTS:
        out["septic_xsec"] = render_septic_xsec_png(model, output_dir / f"{slug}_Septic_XSec.png")
    if inp.treatment_system == TreatmentSystemType.SECONDARY_REED_BED:
        out["reed_bed_xsec"] = render_reed_bed_xsec_png(inp, model, output_dir / f"{slug}_ReedBed_XSec.png")
    if inp.land_application_type == LandApplicationType.ETA_BEDS:
        out["laa_xsec"] = render_eta_xsec_png(inp, model, audit, output_dir / f"{slug}_ETA_XSec.png")
    else:
        out["laa_xsec"] = render_sdi_xsec_png(inp, model, output_dir / f"{slug}_SDI_XSec.png")
    return out
