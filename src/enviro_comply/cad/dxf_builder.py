"""Pure-ezdxf AutoCAD DXF layout generator (matplotlib-free, runs in both Desktop Python and Browser Pyodide).

Single source of truth for native 1:1 metric `.dxf` engineering plans:
- Supports real GDA2020 / MGA Zone 56 field pins (or explicit local metre pins) with automatic schematic fallback.
- Overlays the subject parcel boundary (`0_PARCEL_BOUNDARY`) when spatial parcel geometry and MGA56 pins align.
- Supports both passive ETA beds and contiguous SDI / Spray Irrigation zones, plus Grease Arrestor & Surge Balance Tank.
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass, field
from typing import Any

import ezdxf

from enviro_comply.schemas.ossm import (
    FieldPin,
    LandApplicationType,
    SiteAssessmentInput,
    TreatmentSystemType,
    WastewaterModelResult,
)

_DEG2RAD = math.pi / 180.0


def wgs84_to_mga56(lon: float, lat: float) -> tuple[float, float]:
    """Convert WGS84/GDA2020 (lon, lat) -> GDA2020 / MGA Zone 56 (EPSG:7856) Easting, Northing (metres)."""
    a = 6378137.0
    f = 1.0 / 298.257222101
    k0 = 0.9996
    e2 = 2.0 * f - f * f
    ep2 = e2 / (1.0 - e2)
    lon0 = 153.0 * _DEG2RAD

    phi = lat * _DEG2RAD
    lam = lon * _DEG2RAD
    sin_phi = math.sin(phi)
    cos_phi = math.cos(phi)
    tan_phi = math.tan(phi)

    n_val = a / math.sqrt(1.0 - e2 * sin_phi * sin_phi)
    t_val = tan_phi * tan_phi
    c_val = ep2 * cos_phi * cos_phi
    a_val = cos_phi * (lam - lon0)

    m_val = a * (
        (1.0 - e2 / 4.0 - 3.0 * e2 * e2 / 64.0 - 5.0 * e2**3 / 256.0) * phi
        - (3.0 * e2 / 8.0 + 3.0 * e2 * e2 / 32.0 + 45.0 * e2**3 / 1024.0) * math.sin(2.0 * phi)
        + (15.0 * e2 * e2 / 256.0 + 45.0 * e2**3 / 1024.0) * math.sin(4.0 * phi)
        - (35.0 * e2**3 / 3072.0) * math.sin(6.0 * phi)
    )

    easting = 500000.0 + k0 * n_val * (
        a_val
        + ((1.0 - t_val + c_val) * a_val**3) / 6.0
        + ((5.0 - 18.0 * t_val + t_val * t_val + 72.0 * c_val - 58.0 * ep2) * a_val**5) / 120.0
    )
    northing = 10000000.0 + k0 * (
        m_val
        + n_val
        * tan_phi
        * (
            (a_val * a_val) / 2.0
            + ((5.0 - t_val + 9.0 * c_val + 4.0 * c_val * c_val) * a_val**4) / 24.0
            + ((61.0 - 58.0 * t_val + t_val * t_val + 600.0 * c_val - 330.0 * ep2) * a_val**6) / 720.0
        )
    )
    return (round(easting, 2), round(northing, 2))


def _pin_to_mga56(pin: FieldPin) -> tuple[float, float] | None:
    """Resolve true MGA56 (Easting, Northing) for a FieldPin, supporting legacy WGS84-in-MGA fields."""
    if pin.easting_mga56 is not None and pin.northing_mga56 is not None:
        if abs(pin.northing_mga56) > 1000.0 and abs(pin.easting_mga56) > 1000.0:
            return (float(pin.easting_mga56), float(pin.northing_mga56))
        if abs(pin.northing_mga56) <= 90.0 and abs(pin.easting_mga56) <= 180.0:
            return wgs84_to_mga56(float(pin.easting_mga56), float(pin.northing_mga56))
    if pin.longitude is not None and pin.latitude is not None:
        return wgs84_to_mga56(float(pin.longitude), float(pin.latitude))
    return None


@dataclass
class ResolvedLayout:
    dw_x: float
    dw_y: float
    dw_w: float
    dw_l: float
    st_x: float
    st_y: float
    st_r: float
    has_rb: bool
    rb_x: float
    rb_y: float
    rb_w: float
    rb_l: float
    is_irrig: bool
    eta_x: float
    eta_y: float
    trench_centres_y: list[float]
    swale_y: float
    swale_half_w: float
    veg_y: float
    res_x: float
    res_cy: float
    bh_positions: list[tuple[float, float]]
    has_real_mga_pins: bool = False
    origin_mga56: tuple[float, float] | None = None
    parcel_rings_local: list[list[tuple[float, float]]] = field(default_factory=list)


def _extract_parcel_rings_local(
    spatial_data: dict[str, Any] | None,
    origin_mga56: tuple[float, float] | None,
) -> list[list[tuple[float, float]]]:
    if not spatial_data or not origin_mga56:
        return []
    orig_e, orig_n = origin_mga56
    rings_out: list[list[tuple[float, float]]] = []

    feat_mga = spatial_data.get("parcel_geometry_mga56")
    feat_wgs = spatial_data.get("parcel_geojson")

    def _collect(geom: dict[str, Any], is_wgs: bool) -> None:
        gtype = geom.get("type")
        coords = geom.get("coordinates") or []
        raw_rings: list[list[Any]] = []
        if gtype == "Polygon" and coords:
            raw_rings = [coords[0]]
        elif gtype == "MultiPolygon":
            raw_rings = [poly[0] for poly in coords if poly]
        for r in raw_rings:
            pts: list[tuple[float, float]] = []
            for pt in r:
                if len(pt) < 2:
                    continue
                if is_wgs:
                    e, n = wgs84_to_mga56(float(pt[0]), float(pt[1]))
                else:
                    e, n = float(pt[0]), float(pt[1])
                pts.append((round(e - orig_e, 2), round(n - orig_n, 2)))
            if len(pts) >= 3:
                rings_out.append(pts)

    if isinstance(feat_mga, dict) and isinstance(feat_mga.get("geometry"), dict):
        _collect(feat_mga["geometry"], is_wgs=False)
    elif isinstance(feat_wgs, dict) and isinstance(feat_wgs.get("geometry"), dict):
        _collect(feat_wgs["geometry"], is_wgs=True)

    return rings_out


def resolve_layout_geometry(
    inp: SiteAssessmentInput,
    model: WastewaterModelResult,
    spatial_data: dict[str, Any] | None = None,
) -> ResolvedLayout:
    """Resolve 1:1 metric coordinates for every OSSM feature from field pins or schematic defaults."""
    # Map feature_type -> latest pin (or list for boreholes)
    pins_by_type: dict[str, FieldPin] = {}
    bh_pins: list[FieldPin] = []
    mga_coords: dict[int, tuple[float, float]] = {}

    for idx, p in enumerate(inp.field_pins):
        if p.feature_type == "borehole":
            bh_pins.append(p)
        else:
            pins_by_type[p.feature_type] = p
        m = _pin_to_mga56(p)
        if m is not None:
            mga_coords[idx] = m

    # Determine if real MGA56 pins were captured
    has_real_mga = len(mga_coords) > 0
    origin_mga: tuple[float, float] | None = None
    if has_real_mga:
        dw_pin_for_orig = pins_by_type.get("dwelling")
        if dw_pin_for_orig is not None:
            origin_mga = _pin_to_mga56(dw_pin_for_orig)
        if origin_mga is None and spatial_data:
            ce = spatial_data.get("centroid_easting_mga56")
            cn = spatial_data.get("centroid_northing_mga56")
            if ce is not None and cn is not None:
                origin_mga = (float(ce), float(cn))
        if origin_mga is None:
            origin_mga = next(iter(mga_coords.values()))

    def pin_xy(pin: FieldPin | None, default_xy: tuple[float, float]) -> tuple[float, float]:
        if pin is None:
            return default_xy
        if has_real_mga and origin_mga is not None:
            m = _pin_to_mga56(pin)
            if m is not None:
                return (round(m[0] - origin_mga[0], 2), round(m[1] - origin_mga[1], 2))
        if abs(pin.local_x_m) > 1e-6 or abs(pin.local_y_m) > 1e-6:
            return (float(pin.local_x_m), float(pin.local_y_m))
        return default_xy

    dw_pin = pins_by_type.get("dwelling")
    dw_x, dw_y = pin_xy(dw_pin, (0.0, 0.0) if has_real_mga else (0.0, 12.0))
    dw_w = float(dw_pin.width_m) if (dw_pin and dw_pin.width_m) else 10.0
    dw_l = float(dw_pin.length_m) if (dw_pin and dw_pin.length_m) else 6.0

    st_pin = pins_by_type.get("septic_tank")
    st_x, st_y = pin_xy(st_pin, (dw_x, dw_y - dw_l / 2.0 - 4.5))
    st_r = 1.0

    has_rb = inp.treatment_system == TreatmentSystemType.SECONDARY_REED_BED
    rb_pin = pins_by_type.get("reed_bed")
    rb_x, rb_y = pin_xy(rb_pin, (st_x, st_y - 4.0))
    rb_w = 1.9
    rb_l = 3.0 * max(1, model.recommended_reed_bed_count)

    is_irrig = inp.land_application_type != LandApplicationType.ETA_BEDS
    tr = model.trench_layout

    eta_pin = pins_by_type.get("eta_bed")
    default_eta_y = (rb_y - rb_l / 2.0 - 3.5) if has_rb else (st_y - 7.0)
    eta_x, eta_y = pin_xy(eta_pin, (rb_x if has_rb else st_x, default_eta_y))

    trench_centres_y: list[float] = []
    if is_irrig:
        zone_cy = eta_y - tr.trench_width_m / 2.0 if eta_pin is None else eta_y
        trench_centres_y.append(zone_cy)
    else:
        for i in range(tr.number_of_trenches):
            trench_centres_y.append(eta_y - i * (tr.trench_width_m + tr.trench_separation_m))

    top_laa_y = trench_centres_y[0] + tr.trench_width_m / 2.0
    bot_laa_y = trench_centres_y[-1] - tr.trench_width_m / 2.0
    swale_y = top_laa_y + 1.5
    swale_half_w = tr.trench_length_m / 2.0 + 2.0
    veg_y = bot_laa_y - 1.2

    res_pin = pins_by_type.get("reserve_laa")
    default_res_cy = veg_y - 2.6 - tr.envelope_width_m / 2.0
    res_x, res_cy = pin_xy(res_pin, (eta_x, default_res_cy))

    bh_positions: list[tuple[float, float]] = []
    if bh_pins:
        for idx, bp in enumerate(bh_pins):
            bh_positions.append(pin_xy(bp, (eta_x - tr.trench_length_m / 2.0 + 1.5 + idx * 3.0, trench_centres_y[0])))
    else:
        bh_positions = [
            (eta_x - tr.trench_length_m / 2.0 + 1.5, trench_centres_y[0] + 0.3),
            (eta_x + tr.trench_length_m / 2.0 - 1.5, trench_centres_y[-1] - 0.3),
        ]

    parcel_rings = _extract_parcel_rings_local(spatial_data, origin_mga) if has_real_mga else []

    return ResolvedLayout(
        dw_x=dw_x,
        dw_y=dw_y,
        dw_w=dw_w,
        dw_l=dw_l,
        st_x=st_x,
        st_y=st_y,
        st_r=st_r,
        has_rb=has_rb,
        rb_x=rb_x,
        rb_y=rb_y,
        rb_w=rb_w,
        rb_l=rb_l,
        is_irrig=is_irrig,
        eta_x=eta_x,
        eta_y=eta_y,
        trench_centres_y=trench_centres_y,
        swale_y=swale_y,
        swale_half_w=swale_half_w,
        veg_y=veg_y,
        res_x=res_x,
        res_cy=res_cy,
        bh_positions=bh_positions,
        has_real_mga_pins=has_real_mga,
        origin_mga56=origin_mga,
        parcel_rings_local=parcel_rings,
    )


def _add_rect_dxf(
    msp: Any,
    cx: float,
    cy: float,
    w: float,
    h: float,
    layer: str,
    hatch_pattern: str | None = None,
) -> None:
    x0, y0 = cx - w / 2.0, cy - h / 2.0
    pts = [(x0, y0), (x0 + w, y0), (x0 + w, y0 + h), (x0, y0 + h), (x0, y0)]
    msp.add_lwpolyline(pts, dxfattribs={"layer": layer})
    if hatch_pattern:
        hatch = msp.add_hatch(dxfattribs={"layer": layer})
        hatch.set_pattern_fill(hatch_pattern, scale=0.4)
        hatch.paths.add_polyline_path(pts[:-1], is_closed=True)


def build_ossm_dxf_bytes(
    inp: SiteAssessmentInput,
    model: WastewaterModelResult,
    spatial_data: dict[str, Any] | None = None,
    layout: ResolvedLayout | None = None,
) -> bytes:
    """Compile a native AutoCAD R2010 `.dxf` site layout plan (1:1 metric) and return raw UTF-8 bytes."""
    lay = layout or resolve_layout_geometry(inp, model, spatial_data=spatial_data)
    tr = model.trench_layout

    doc = ezdxf.new("R2010")
    doc.units = ezdxf.units.M
    msp = doc.modelspace()

    if "DASHED" not in doc.linetypes:
        doc.linetypes.add("DASHED", pattern=[0.6, 0.4, -0.2])

    layers = [
        ("0_PARCEL_BOUNDARY", 8, "DASHED"),
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
    for name, color, ltype in layers:
        doc.layers.add(name, color=color, linetype=ltype)

    # Track extents for clean title-block framing
    xs: list[float] = [
        lay.dw_x - lay.dw_w / 2.0 - 3.5,
        lay.dw_x + lay.dw_w / 2.0 + 3.5,
        lay.eta_x - tr.trench_length_m / 2.0 - 4.0,
        lay.eta_x + tr.trench_length_m / 2.0 + 8.0,
        lay.res_x - tr.trench_length_m / 2.0 - 2.0,
        lay.res_x + tr.trench_length_m / 2.0 + 2.0,
    ]
    ys: list[float] = [
        lay.dw_y + lay.dw_l / 2.0 + 5.0,
        lay.dw_y - lay.dw_l / 2.0 - 3.5,
        lay.swale_y + 2.0,
        lay.res_cy - tr.envelope_width_m / 2.0 - 5.0,
        lay.res_cy + tr.envelope_width_m / 2.0 + 2.0,
    ]

    # 0. Subject Parcel Boundary (when real MGA56 pins + spatial geometry are present)
    for ring in lay.parcel_rings_local:
        closed = ring if ring[0] == ring[-1] else ring + [ring[0]]
        msp.add_lwpolyline(closed, dxfattribs={"layer": "0_PARCEL_BOUNDARY"})

    # 1. Dwelling + 3m septic clearance
    _add_rect_dxf(msp, lay.dw_x, lay.dw_y, lay.dw_w, lay.dw_l, "1_DWELLING", hatch_pattern="ANSI31")
    _add_rect_dxf(msp, lay.dw_x, lay.dw_y, lay.dw_w + 6.0, lay.dw_l + 6.0, "7_SETBACKS")
    msp.add_text(
        "EXISTING / PROPOSED DWELLING",
        dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.45},
    ).set_placement((lay.dw_x, lay.dw_y), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)

    # Optional Grease Arrestor (commercial/food processing)
    if model.grease_arrestor_min_l > 0:
        ga_x, ga_y = lay.st_x - 3.2, lay.st_y + 1.4
        _add_rect_dxf(msp, ga_x, ga_y, 1.8, 1.2, "2_SEPTIC_TANK")
        msp.add_line((lay.dw_x, lay.dw_y - lay.dw_l / 2.0), (ga_x, ga_y + 0.6), dxfattribs={"layer": "6_PIPES"})
        msp.add_line((ga_x + 0.9, ga_y), (lay.st_x - lay.st_r, lay.st_y), dxfattribs={"layer": "6_PIPES"})
        msp.add_text(
            f"{model.grease_arrestor_min_l}L GREASE ARRESTOR",
            dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.30},
        ).set_placement((ga_x, ga_y + 0.9), align=ezdxf.enums.TextEntityAlignment.BOTTOM_CENTER)
        xs.append(ga_x - 2.0)

    # 2. Septic Tank
    msp.add_circle((lay.st_x, lay.st_y), radius=lay.st_r, dxfattribs={"layer": "2_SEPTIC_TANK"})
    msp.add_line((lay.st_x - lay.st_r, lay.st_y), (lay.st_x + lay.st_r, lay.st_y), dxfattribs={"layer": "2_SEPTIC_TANK"})
    msp.add_line((lay.dw_x, lay.dw_y - lay.dw_l / 2.0), (lay.st_x, lay.st_y + lay.st_r), dxfattribs={"layer": "6_PIPES"})
    msp.add_text(
        f"{model.septic_tank_min_l}L SEPTIC TANK + FILTER",
        dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.35},
    ).set_placement((lay.st_x + 1.5, lay.st_y), align=ezdxf.enums.TextEntityAlignment.MIDDLE_LEFT)

    # Optional Surge / Balance Tank
    if model.surge_tank_min_l > 0:
        sb_x, sb_y = lay.st_x + 3.2, lay.st_y - 1.5
        msp.add_circle((sb_x, sb_y), radius=0.85, dxfattribs={"layer": "2_SEPTIC_TANK"})
        msp.add_line((lay.st_x + lay.st_r, lay.st_y), (sb_x - 0.85, sb_y), dxfattribs={"layer": "6_PIPES"})
        msp.add_text(
            f"{model.surge_tank_min_l}L SURGE TANK",
            dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.30},
        ).set_placement((sb_x + 1.1, sb_y), align=ezdxf.enums.TextEntityAlignment.MIDDLE_LEFT)
        xs.append(sb_x + 4.5)

    # 3. Reed Bed (if applicable)
    if lay.has_rb:
        _add_rect_dxf(msp, lay.rb_x, lay.rb_y, lay.rb_w, lay.rb_l, "3_REED_BED", hatch_pattern="GRAVEL")
        msp.add_line((lay.st_x, lay.st_y - lay.st_r), (lay.rb_x, lay.rb_y + lay.rb_l / 2.0), dxfattribs={"layer": "6_PIPES"})
        msp.add_text(
            f"{model.recommended_reed_bed_count}x REED BED TRAY ({lay.rb_w:.1f}m x {lay.rb_l:.1f}m = {model.recommended_reed_bed_provided_m2:.1f}m2)",
            dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.35},
        ).set_placement((lay.rb_x + lay.rb_w / 2.0 + 0.6, lay.rb_y), align=ezdxf.enums.TextEntityAlignment.MIDDLE_LEFT)
        feed_from = (lay.rb_x, lay.rb_y - lay.rb_l / 2.0)
    else:
        feed_from = (lay.st_x, lay.st_y - lay.st_r)

    # 4. Land Application Area (ETA Beds OR Contiguous SDI/Spray Irrigation Zone)
    if lay.is_irrig:
        zone_cy = lay.trench_centres_y[0]
        _add_rect_dxf(msp, lay.eta_x, zone_cy, tr.trench_length_m, tr.trench_width_m, "4_ETA_BED", hatch_pattern="ANSI37")
        irrig_title = (
            "SURFACE SPRAY IRRIGATION ZONE"
            if inp.land_application_type == LandApplicationType.SURFACE_SPRAY_IRRIGATION
            else "SUB-SURFACE DRIP IRRIGATION ZONE (SDI)"
        )
        msp.add_text(
            f"{irrig_title}: {tr.trench_length_m:.1f}m x {tr.trench_width_m:.1f}m ({model.required_laa_m2:.1f}m2)",
            dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.42},
        ).set_placement((lay.eta_x, zone_cy), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)
        msp.add_line(feed_from, (lay.eta_x, zone_cy + tr.trench_width_m / 2.0), dxfattribs={"layer": "6_PIPES"})
    else:
        for i, ty in enumerate(lay.trench_centres_y):
            _add_rect_dxf(msp, lay.eta_x, ty, tr.trench_length_m, tr.trench_width_m, "4_ETA_BED", hatch_pattern="ANSI37")
            msp.add_line(
                (lay.eta_x - tr.trench_length_m / 2.0 + 0.5, ty),
                (lay.eta_x + tr.trench_length_m / 2.0 - 0.5, ty),
                dxfattribs={"layer": "6_PIPES"},
            )
            msp.add_text(
                f"ETA BED {i+1}: {tr.trench_length_m:.1f}m x {tr.trench_width_m:.1f}m x {int(inp.root_zone_depth_mm + inp.gravel_depth_mm)}mm",
                dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.35},
            ).set_placement((lay.eta_x + tr.trench_length_m / 2.0 + 0.6, ty), align=ezdxf.enums.TextEntityAlignment.MIDDLE_LEFT)
        msp.add_line(feed_from, (lay.eta_x, lay.trench_centres_y[0] + tr.trench_width_m / 2.0), dxfattribs={"layer": "6_PIPES"})

    # 8. Upslope Diversion Swale
    msp.add_lwpolyline(
        [
            (lay.eta_x - lay.swale_half_w, lay.swale_y - 0.6),
            (lay.eta_x - lay.swale_half_w + 1.2, lay.swale_y),
            (lay.eta_x + lay.swale_half_w - 1.2, lay.swale_y),
            (lay.eta_x + lay.swale_half_w, lay.swale_y - 0.6),
        ],
        dxfattribs={"layer": "8_DIVERSION_SWALE"},
    )
    msp.add_text(
        "UPSLOPE RUN-ON DIVERSION SWALE",
        dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.30},
    ).set_placement((lay.eta_x, lay.swale_y + 0.45), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)

    # 10. Downslope Lomandra uptake planting row
    n_plants = max(4, min(30, int(tr.trench_length_m)))
    for k in range(n_plants):
        px = lay.eta_x - tr.trench_length_m / 2.0 + 0.5 + k * max(0.0, tr.trench_length_m - 1.0) / max(1, n_plants - 1)
        msp.add_circle((px, lay.veg_y), radius=0.25, dxfattribs={"layer": "10_VEGETATION"})
    msp.add_text(
        "DOUBLE ROW LOMANDRA HYSTRIX (1m OFFSET)",
        dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.28},
    ).set_placement((lay.eta_x, lay.veg_y - 0.65), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)

    # 5. Reserve LAA (100% alternate area)
    _add_rect_dxf(msp, lay.res_x, lay.res_cy, tr.trench_length_m, tr.envelope_width_m, "5_RESERVE_LAA")
    msp.add_text(
        f"NOMINATED 100% RESERVE LAA ({model.reserve_laa_m2:.1f} m2)",
        dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.35},
    ).set_placement((lay.res_x, lay.res_cy), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)

    # 9. Borehole locations
    for idx, (bx, by) in enumerate(lay.bh_positions):
        msp.add_circle((bx, by), radius=0.32, dxfattribs={"layer": "9_BOREHOLES"})
        msp.add_line((bx - 0.32, by), (bx + 0.32, by), dxfattribs={"layer": "9_BOREHOLES"})
        msp.add_line((bx, by - 0.32), (bx, by + 0.32), dxfattribs={"layer": "9_BOREHOLES"})
        msp.add_text(f"BH{idx+1}", dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.30}).set_placement((bx + 0.45, by + 0.35))
        xs.extend([bx - 1.5, bx + 1.5])
        ys.extend([by - 1.5, by + 1.5])

    # 12. Title Block border
    tb_minx = min(-14.0, min(xs) - 2.0)
    tb_maxx = max(18.0, max(xs) + 2.0)
    tb_miny = min(ys) - 2.0
    tb_maxy = max(ys) + 2.0
    msp.add_lwpolyline(
        [(tb_minx, tb_miny), (tb_maxx, tb_miny), (tb_maxx, tb_maxy), (tb_minx, tb_maxy), (tb_minx, tb_miny)],
        dxfattribs={"layer": "12_TITLE_BLOCK"},
    )
    coord_note = (
        f" | MGA56 Origin: E{lay.origin_mga56[0]:.1f} N{lay.origin_mga56[1]:.1f}"
        if lay.has_real_mga_pins and lay.origin_mga56
        else " | Local 1:1 Metric Grid"
    )
    msp.add_text(
        f"OSSM LAYOUT PLAN | {inp.site_address} (Lot {inp.lot_number} {inp.plan_label}) | Applicant: {inp.applicant_name} | Ref: {inp.project_ref}{coord_note}",
        dxfattribs={"layer": "12_TITLE_BLOCK", "height": 0.42},
    ).set_placement((tb_minx + 0.6, tb_miny + 1.0))

    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("utf-8")
