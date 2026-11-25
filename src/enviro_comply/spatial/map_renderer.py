"""Print-ready GDA2020 / MGA Zone 56 GIS Site Location & Buffer Compliance Map renderer.

Replaces manual screenshots from Lismore City Council's GIS viewer with a crisp, scaled,
coordinate-gridded engineering map (PNG + PDF) showing cadastre, neighbours, contours,
watercourses, 40 m / 100 m buffer overlays, north arrow, scale bar, and title block.
"""

from __future__ import annotations

import math
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Patch, Polygon as MplPolygon
from matplotlib.lines import Line2D
from shapely.geometry import shape

from enviro_comply.schemas.ossm import SiteAssessmentInput, SpatialPreCheckResult


def _plot_geom(ax: plt.Axes, geom: Any, **kwargs: Any) -> None:
    if geom.is_empty:
        return
    gtype = geom.geom_type
    if gtype == "Polygon":
        xs, ys = geom.exterior.xy
        ax.fill(xs, ys, **kwargs)
    elif gtype == "MultiPolygon":
        for poly in geom.geoms:
            xs, ys = poly.exterior.xy
            ax.fill(xs, ys, **kwargs)
    elif gtype == "LineString":
        xs, ys = geom.xy
        ax.plot(xs, ys, **kwargs)
    elif gtype == "MultiLineString":
        for line in geom.geoms:
            xs, ys = line.xy
            ax.plot(xs, ys, **kwargs)


def _draw_scale_bar(ax: plt.Axes, x0: float, y0: float, span_x: float) -> None:
    # Choose nice metric bar length (50, 100, 200, 250, 500 m)
    target = span_x * 0.22
    nice_lengths = [20, 50, 100, 200, 250, 500, 1000]
    bar_len = min(nice_lengths, key=lambda v: abs(v - target))
    seg = bar_len / 4.0
    h = span_x * 0.012
    for i in range(4):
        color = "#1f2937" if i % 2 == 0 else "#ffffff"
        rect = plt.Rectangle((x0 + i * seg, y0), seg, h, facecolor=color, edgecolor="#1f2937", linewidth=0.9, zorder=15)
        ax.add_patch(rect)
    for i in (0, 2, 4):
        lbl = f"{int(i * seg)} m" if i == 4 else f"{int(i * seg)}"
        ax.text(x0 + i * seg, y0 + h * 1.4, lbl, fontsize=7.5, ha="center", va="bottom", color="#111827", fontweight="bold", zorder=16)


def _draw_north_arrow(ax: plt.Axes, x: float, y: float, size: float) -> None:
    ax.annotate(
        "",
        xy=(x, y + size),
        xytext=(x, y),
        arrowprops=dict(arrowstyle="-|>", color="#111827", lw=2.0, mutation_scale=16),
        zorder=16,
    )
    ax.text(x, y + size * 1.12, "N", fontsize=11, fontweight="bold", ha="center", va="bottom", color="#111827", zorder=16)


def render_gis_site_map(
    inp: SiteAssessmentInput,
    spatial: SpatialPreCheckResult,
    out_png: Path,
    out_pdf: Path | None = None,
) -> tuple[Path, Path | None]:
    """Render a GDA2020 / MGA Zone 56 site location and environmental buffer map."""
    out_png.parent.mkdir(parents=True, exist_ok=True)

    fig = plt.figure(figsize=(11.69, 8.27), dpi=220)  # A4 Landscape
    ax = fig.add_axes([0.06, 0.20, 0.88, 0.74])
    ax.set_facecolor("#f8fafc")

    if spatial.parcel_geometry_mga56:
        parcel = shape(spatial.parcel_geometry_mga56["geometry"])
        minx, miny, maxx, maxy = parcel.bounds
        pad = max(maxx - minx, maxy - miny) * 0.28
        pad = max(pad, 80.0)
        view_minx, view_maxx = minx - pad, maxx + pad
        view_miny, view_maxy = miny - pad, maxy + pad

        # Neighbour parcels
        for nf in spatial.neighbour_parcels_mga56:
            ng = shape(nf["geometry"])
            _plot_geom(ax, ng, facecolor="#ffffff", edgecolor="#94a3b8", linewidth=0.8, zorder=2)
            c = ng.representative_point()
            if view_minx < c.x < view_maxx and view_miny < c.y < view_maxy:
                props = nf.get("properties", {})
                lbl = f"Lot {props.get('lotnumber', '')}\n{props.get('planlabel', '')}"
                ax.text(c.x, c.y, lbl, fontsize=6.5, color="#475569", ha="center", va="center", zorder=6)

        # Subject parcel
        _plot_geom(ax, parcel, facecolor="#fecaca", edgecolor="#991b1b", linewidth=2.0, alpha=0.65, zorder=4)
        pc = parcel.representative_point()
        ax.text(
            pc.x,
            pc.y,
            f"SUBJECT LOT\nLot {inp.lot_number} {inp.plan_label}\n({spatial.parcel_area_ha or round(inp.block_size_m2/10000, 2):.2f} ha)",
            fontsize=8.5,
            fontweight="bold",
            color="#7f1d1d",
            ha="center",
            va="center",
            bbox=dict(boxstyle="round,pad=0.3", facecolor="white", edgecolor="#991b1b", alpha=0.85),
            zorder=10,
        )

        # Contours
        for cf in spatial.contours_mga56:
            cg = shape(cf["geometry"])
            _plot_geom(ax, cg, color="#cbd5e1", linewidth=0.55, linestyle="-", zorder=3)

        # Watercourses + 40m gully buffer
        for wf in spatial.watercourses_mga56:
            wg = shape(wf["geometry"])
            buf40 = wg.buffer(40.0)
            _plot_geom(ax, buf40, facecolor="#bfdbfe", edgecolor="#3b82f6", linewidth=0.5, linestyle="--", alpha=0.22, zorder=5)
            _plot_geom(ax, wg, color="#1d4ed8", linewidth=1.4, zorder=7)

        ax.set_xlim(view_minx, view_maxx)
        ax.set_ylim(view_miny, view_maxy)
        ax.set_aspect("equal", adjustable="datalim")

        span_x = view_maxx - view_minx
        span_y = view_maxy - view_miny
        _draw_scale_bar(ax, view_minx + span_x * 0.04, view_miny + span_y * 0.04, span_x)
        _draw_north_arrow(ax, view_maxx - span_x * 0.06, view_miny + span_y * 0.06, span_y * 0.09)
    else:
        # Offline schematic fallback
        side = math.sqrt(inp.block_size_m2)
        ax.add_patch(plt.Rectangle((0, 0), side, side, facecolor="#fecaca", edgecolor="#991b1b", lw=2.0, alpha=0.6))
        ax.text(side / 2, side / 2, f"Lot {inp.lot_number} {inp.plan_label}\n({inp.block_size_m2:,.0f} m²)\n[Offline Cadastre Placeholder]", ha="center", va="center", fontsize=10, fontweight="bold", color="#7f1d1d")
        ax.set_xlim(-side * 0.2, side * 1.2)
        ax.set_ylim(-side * 0.2, side * 1.2)
        ax.set_aspect("equal")

    ax.grid(True, linestyle=":", color="#cbd5e1", linewidth=0.6, zorder=1)
    ax.ticklabel_format(style="plain", useOffset=False)
    ax.set_xlabel("Easting (m) — GDA2020 / MGA Zone 56 (EPSG:7856)", fontsize=8.5, color="#334155")
    ax.set_ylabel("Northing (m) — GDA2020 / MGA Zone 56 (EPSG:7856)", fontsize=8.5, color="#334155")
    ax.tick_params(labelsize=7.5)
    ax.set_title(
        f"SITE LOCATION & ENVIRONMENTAL CONSTRAINTS MAP — {inp.site_address} (Lot {inp.lot_number} {inp.plan_label})",
        fontsize=11,
        fontweight="bold",
        color="#0f172a",
        pad=10,
    )

    legend_handles = [
        Patch(facecolor="#fecaca", edgecolor="#991b1b", lw=1.5, label=f"Subject Parcel (Lot {inp.lot_number} {inp.plan_label})"),
        Patch(facecolor="#ffffff", edgecolor="#94a3b8", lw=0.8, label="Adjoining Cadastre"),
        Line2D([0], [0], color="#1d4ed8", lw=1.5, label="Mapped Watercourse / Drainage Line"),
        Patch(facecolor="#bfdbfe", edgecolor="#3b82f6", ls="--", alpha=0.35, label="40 m Gully / Ephemeral Stream Buffer"),
        Line2D([0], [0], color="#cbd5e1", lw=0.9, label="Topographic Contours (NSW Elevation)"),
    ]
    ax.legend(handles=legend_handles, loc="upper right", fontsize=7.5, framealpha=0.95, edgecolor="#cbd5e1")

    # Formal Engineering Title Block Footer
    tb = fig.add_axes([0.06, 0.03, 0.88, 0.12])
    tb.set_xlim(0, 1)
    tb.set_ylim(0, 1)
    tb.axis("off")
    tb.add_patch(FancyBboxPatch((0, 0), 1, 1, boxstyle="square,pad=0", facecolor="#f8fafc", edgecolor="#1e293b", lw=1.2))
    tb.plot([0.37, 0.37], [0, 1], color="#1e293b", lw=0.8)
    tb.plot([0.70, 0.70], [0, 1], color="#1e293b", lw=0.8)

    zoning_str = ", ".join(spatial.land_zoning) if spatial.land_zoning else "Verify LEP"
    tb.text(0.012, 0.78, "PROJECT & SITE DETAILS", fontsize=7.2, fontweight="bold", color="#0f172a")
    tb.text(0.012, 0.53, f"Site: {inp.site_address}", fontsize=7.2, color="#1e293b")
    tb.text(0.012, 0.30, f"Lot/DP: Lot {inp.lot_number} {inp.plan_label}  |  LGA: {inp.lga}", fontsize=7.2, color="#1e293b")
    tb.text(0.012, 0.08, f"Applicant: {inp.applicant_name}  |  Zoning: {zoning_str}", fontsize=7.0, color="#334155")

    tb.text(0.382, 0.78, "SPATIAL METADATA & SOURCE", fontsize=7.2, fontweight="bold", color="#0f172a")
    tb.text(0.382, 0.53, f"Datum: {spatial.crs_name} (EPSG:{spatial.crs_epsg})", fontsize=7.0, color="#1e293b")
    tb.text(0.382, 0.30, "Sources: NSW Spatial Services & Planning Portal", fontsize=6.8, color="#334155")
    tb.text(0.382, 0.08, "Note: Diagrammatic only. Confirm offsets on site.", fontsize=6.6, color="#475569")

    tb.text(0.712, 0.78, "PREPARED BY", fontsize=7.2, fontweight="bold", color="#0f172a")
    tb.text(0.712, 0.53, f"{inp.consultant.name} ({inp.consultant.licence_number or 'Consultant'})", fontsize=7.0, color="#1e293b")
    tb.text(0.712, 0.30, f"Ref: {inp.project_ref}  |  Date: {inp.site_eval.assessment_date.isoformat()}", fontsize=7.0, color="#1e293b")
    tb.text(0.712, 0.08, "Drawing: OSSM-GIS-01  |  FOR S68 SUBMISSION", fontsize=7.0, fontweight="bold", color="#991b1b")

    fig.savefig(out_png, dpi=220)
    if out_pdf is not None:
        fig.savefig(out_pdf)
    plt.close(fig)
    return out_png, out_pdf
