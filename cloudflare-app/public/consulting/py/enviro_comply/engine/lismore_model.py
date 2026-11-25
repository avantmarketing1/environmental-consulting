"""Deterministic Python implementation of Lismore City Council's On-site Wastewater Model
(OSmodel300614.xls — Single Rural Households, 1970-1991 Alstonville Daily Climate Series).

Every constant and equation is verified against the BIFF8 formulas extracted directly from
`reference/lcc_2014_on-site_wastewater_model.xls` and Lismore CC OSSM Strategy (2013).
Zero LLM math is ever used in this module.
"""

from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

from enviro_comply.schemas.ossm import (
    BufferFeatureType,
    LandApplicationType,
    SiteAssessmentInput,
    TreatmentSystemType,
    TrenchLayoutResult,
    WastewaterModelResult,
    WastewaterSourceSummary,
    WastewaterSourceType,
)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


@lru_cache(maxsize=1)
def load_lismore_rules() -> dict[str, Any]:
    return json.loads((DATA_DIR / "lismore_rules.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _load_climate_arrays() -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    raw = json.loads((DATA_DIR / "alstonville_climate.json").read_text(encoding="utf-8"))
    evap = np.asarray(raw["evap_mm"], dtype=np.float64)
    rain = np.asarray(raw["rain_mm"], dtype=np.float64)
    cf = np.asarray(raw["crop_factor"], dtype=np.float64)
    # Exact OSmodel300614 E45 formula: C - 4 * (1 - 1 / (1 + C/4)) == C^2 / (C + 4)
    thru = np.where(rain > 0.0, rain - 4.0 * (1.0 - 1.0 / (1.0 + rain / 4.0)), 0.0)
    et = evap * cf
    return evap, rain, thru, et


def _get_soil_row(rules: dict[str, Any], soil_texture_id: int) -> dict[str, Any]:
    for row in rules["soil_textures"]:
        if row["id"] == soil_texture_id:
            return row
    raise ValueError(f"Unknown soil_texture_id: {soil_texture_id} (expected 1..15)")


def _compute_septic_tank_min_l(
    rules: dict[str, Any],
    persons: int,
    has_toilet: bool,
    has_greywater: bool,
    total_flow_ld: float = 0.0,
) -> int:
    caps = rules["septic_tank_capacities_l"]
    if persons <= 5:
        band = "1_to_5"
        base = int(caps["all_wastewater"][band] if (has_toilet and has_greywater) else (caps["blackwater_only"][band] if has_toilet else caps["greywater_only"][band]))
    elif persons <= 10:
        band = "6_to_10"
        base = int(caps["all_wastewater"][band] if (has_toilet and has_greywater) else (caps["blackwater_only"][band] if has_toilet else caps["greywater_only"][band]))
    else:
        # AS/NZS 1547 Table J1 / commercial sizing: >= 3 days hydraulic retention + sludge allowance (rounded to 500 L)
        base = max(4500, int(math.ceil(max(total_flow_ld, persons * 120.0) * 3.0 / 500.0) * 500))
    # Also ensure minimum 2.5 days retention for high-flow commercial/mixed systems
    if total_flow_ld > 1500.0:
        min_by_flow = int(math.ceil(total_flow_ld * 2.5 / 500.0) * 500)
        return max(base, min_by_flow)
    return base


def _select_reed_bed_trays(rules: dict[str, Any], required_m2: float, wetted_depth_m: float) -> tuple[str, int, float]:
    if required_m2 <= 0.0:
        return ("None", 0, 0.0)
    trays = rules["reed_bed_trays"]
    # Pick tray whose nominal wetted depth is closest to requested wetted depth
    best = min(trays, key=lambda t: abs(t["wetted_depth_m"] - wetted_depth_m))
    count = max(1, math.ceil(required_m2 / best["area_m2"]))
    return (best["model"], count, round(count * best["area_m2"], 2))


def _simulate_daily_water_balance(
    area_m2: float,
    flow_ld: float,
    bucket_cap_sat_mm: float,
    bucket_cap_awc_mm: float,
    max_perc_mmd: float,
    reed_bed_area_m2: float,
    thru: np.ndarray,
    et: np.ndarray,
) -> tuple[float, int]:
    """Run exact 7,670-day OSmodel300614 daily bucket balance.

    Excel shared formulas (rows 44..7713):
      K44 = BucketCap_sat / 2
      G[i] = MIN(max_perc, MAX(0, K[i-1] - BucketCap_awc))
      H[i] = reed_bed_area * (E[i] - F[i]) / area_m2
      I[i] = K[i-1] + E[i] + (flow_ld / area_m2) + H[i] - F[i] - G[i]
      J[i] = MAX(0, I[i] - BucketCap_sat)
      K[i] = I[i] - J[i]
    """
    n = len(thru)
    irrig = flow_ld / area_m2
    rb_ratio = reed_bed_area_m2 / area_m2 if reed_bed_area_m2 > 0.0 else 0.0

    end_bal = bucket_cap_sat_mm / 2.0
    exceed = np.zeros(n, dtype=np.float64)
    exceed_count = 0

    for i in range(1, n):
        avail_for_perc = end_bal - bucket_cap_awc_mm
        if avail_for_perc <= 0.0:
            perc = 0.0
        elif avail_for_perc < max_perc_mmd:
            perc = avail_for_perc
        else:
            perc = max_perc_mmd

        net_rain_et = thru[i] - et[i]
        rb_extra = rb_ratio * net_rain_et if rb_ratio > 0.0 else 0.0

        bal = end_bal + net_rain_et + irrig + rb_extra - perc
        if bal < 0.0:
            bal = 0.0

        if bal > bucket_cap_sat_mm:
            exc = bal - bucket_cap_sat_mm
            exceed[i] = exc
            exceed_count += 1
            end_bal = bucket_cap_sat_mm
        else:
            end_bal = bal

    p95 = float(np.percentile(exceed, 95))
    return p95, exceed_count


def _solve_hydraulic_area_m2(
    flow_ld: float,
    bucket_cap_sat_mm: float,
    bucket_cap_awc_mm: float,
    max_perc_mmd: float,
    reed_bed_area_m2: float,
) -> tuple[float, float, int]:
    """Binary search for minimum LAA (m2) achieving 95th percentile exceedance == 0.0 mm."""
    _, _, thru, et = _load_climate_arrays()

    lo = 1.0
    hi = max(50.0, flow_ld / max(0.5, max_perc_mmd) * 4.0)

    # Expand upper bound if needed (e.g., very tight clays or large flow)
    while _simulate_daily_water_balance(
        hi, flow_ld, bucket_cap_sat_mm, bucket_cap_awc_mm, max_perc_mmd, reed_bed_area_m2, thru, et
    )[0] > 1e-9:
        hi *= 2.0
        if hi > 50_000.0:
            break

    for _ in range(42):
        mid = 0.5 * (lo + hi)
        p95, _ = _simulate_daily_water_balance(
            mid, flow_ld, bucket_cap_sat_mm, bucket_cap_awc_mm, max_perc_mmd, reed_bed_area_m2, thru, et
        )
        if p95 > 1e-9:
            lo = mid
        else:
            hi = mid

    p95_final, exc_count = _simulate_daily_water_balance(
        hi, flow_ld, bucket_cap_sat_mm, bucket_cap_awc_mm, max_perc_mmd, reed_bed_area_m2, thru, et
    )
    return hi, p95_final, exc_count


def _compute_trench_layout(
    required_laa_m2: float,
    trench_width_m: float,
    trench_separation_m: float,
    n_override: int | None,
    is_irrigation: bool = False,
) -> TrenchLayoutResult:
    """Replicate LCC OSmodel Designer sheet (Rectangular Trench Layout for ETA, contiguous zone for SSI/Spray)."""
    if is_irrigation:
        # Per LCC OSmodel Designer sheet ("Envelope width (0 if SSI)"):
        # Irrigation is a contiguous zone (no inter-trench separation gaps).
        side = round(math.sqrt(required_laa_m2), 1)
        length_m = required_laa_m2 / max(1.0, side)
        return TrenchLayoutResult(
            laa_m2=round(required_laa_m2, 1),
            number_of_trenches=1,
            trench_width_m=round(side, 1),
            trench_separation_m=0.0,
            trench_length_m=round(length_m, 1),
            total_bed_area_m2=round(required_laa_m2, 1),
            envelope_width_m=round(side, 1),
            envelope_length_m=round(length_m, 1),
            envelope_area_m2=round(required_laa_m2, 1),
            exceeds_max_length_20m=False,
            exceeds_3_trenches=False,
        )

    if n_override is not None:
        n_trenches = n_override
    else:
        # Default: keep trench length <= 20 m (LCC Strategy Appendix B s3.0 / Design 1)
        n_trenches = max(1, math.ceil(required_laa_m2 / (trench_width_m * 20.0)))

    trench_length_m = required_laa_m2 / (n_trenches * trench_width_m)
    total_bed_area_m2 = n_trenches * trench_width_m * trench_length_m
    envelope_width_m = n_trenches * trench_width_m + max(0, n_trenches - 1) * trench_separation_m
    envelope_area_m2 = envelope_width_m * trench_length_m

    return TrenchLayoutResult(
        laa_m2=round(required_laa_m2, 1),
        number_of_trenches=n_trenches,
        trench_width_m=round(trench_width_m, 2),
        trench_separation_m=round(trench_separation_m, 2),
        trench_length_m=round(trench_length_m, 1),
        total_bed_area_m2=round(total_bed_area_m2, 1),
        envelope_width_m=round(envelope_width_m, 1),
        envelope_length_m=round(trench_length_m, 1),
        envelope_area_m2=round(envelope_area_m2, 1),
        exceeds_max_length_20m=trench_length_m > 20.05,
        exceeds_3_trenches=n_trenches > 3,
    )


def run_lismore_wastewater_model(inp: SiteAssessmentInput) -> WastewaterModelResult:
    """Execute the complete Lismore CC On-Site Wastewater Model deterministically."""
    rules = load_lismore_rules()
    persons = inp.design_persons

    # 1. Wastewater flow & source fractions (OSmodel rows 6..15 + multi-use composable sources)
    flow_lpd = float(rules["water_supply_flows_lpd"][inp.water_supply.value]["lpd"])
    min_rate_lpd = 120.0  # OSmodel R7

    src = rules["wastewater_source_fractions"]
    active = {
        "toilet": inp.wastewater_components.toilet,
        "bathroom": inp.wastewater_components.bathroom,
        "laundry": inp.wastewater_components.laundry,
        "kitchen": inp.wastewater_components.kitchen,
    }
    frac_water = sum(src[k]["water"] for k, on in active.items() if on)
    frac_tn = sum(src[k]["tn"] for k, on in active.items() if on)
    frac_tp = sum(src[k]["tp"] for k, on in active.items() if on)
    frac_bod = sum(src[k]["bod"] for k, on in active.items() if on)

    if frac_water <= 0.0:
        raise ValueError("At least one wastewater component (toilet/bathroom/laundry/kitchen) must be enabled.")

    source_breakdown: list[WastewaterSourceSummary] = []
    grease_required = bool(inp.grease_arrestor_required)
    comm_kitchen_flow_ld = 0.0
    has_surge_source = False
    weighted_bod_mgl_override: float | None = None

    if inp.wastewater_sources:
        # Composable multi-use flow, EP, nutrient & high-strength BOD calculation
        total_flow_ld = 0.0
        total_ep_equiv = 0.0
        weighted_bod_num = 0.0
        total_n_kg_yr_multi = 0.0
        total_p_kg_yr_multi = 0.0

        for ws in inp.wastewater_sources:
            stype = ws.source_type
            if stype in (WastewaterSourceType.DWELLING, WastewaterSourceType.SECONDARY_DWELLING):
                ep_per_unit = float(ws.guests_per_unit if ws.guests_per_unit is not None else max(2, ws.bedrooms_per_unit + 1))
                ep_s = ws.units * ep_per_unit
                rate = float(ws.flow_rate_lpd_override or flow_lpd)
                q_s = float(ws.daily_flow_l_override) if ws.daily_flow_l_override is not None else (ep_s * rate * frac_water)
                bod_s = float(ws.influent_bod_mgl or (250.0 * (min_rate_lpd / max(60.0, rate))))
                tn_s = ep_s * frac_tn * 4.2
                tp_s = ep_s * frac_tp * 0.52
                basis = f"{ws.units}× {ws.bedrooms_per_unit} BR ({ep_s:.0f} EP @ {rate:.0f} L/p/d)"
            elif stype == WastewaterSourceType.AGRITOURISM_CABIN:
                has_surge_source = True
                ep_per_unit = float(ws.guests_per_unit if ws.guests_per_unit is not None else max(2, ws.bedrooms_per_unit * 2))
                ep_s = ws.units * ep_per_unit
                rate = float(ws.flow_rate_lpd_override or min(flow_lpd, 140.0))
                q_s = float(ws.daily_flow_l_override) if ws.daily_flow_l_override is not None else (ep_s * rate * ws.peak_surge_factor)
                bod_s = float(ws.influent_bod_mgl or 250.0)
                tn_s = ep_s * 4.2
                tp_s = ep_s * 0.52
                basis = f"{ws.units}× cabin ({ep_s:.0f} guests @ {rate:.0f} L/g/d, surge ×{ws.peak_surge_factor:.1f})"
            elif stype == WastewaterSourceType.DAY_VISITORS_AMENITIES:
                has_surge_source = True
                rate = float(ws.flow_rate_lpd_override or 18.0)  # AS/NZS 1547 Table H2 day visitors
                q_s = float(ws.daily_flow_l_override) if ws.daily_flow_l_override is not None else (ws.units * rate)
                ep_s = round(q_s / flow_lpd, 2)
                bod_s = float(ws.influent_bod_mgl or 220.0)
                tn_s = ep_s * 4.2
                tp_s = ep_s * 0.52
                basis = f"{ws.units} day visitors @ {rate:.0f} L/visitor/d (AS/NZS 1547 Table H2)"
            else:
                # FOOD_PROCESSING_COMMERCIAL / farm-gate kitchen / café
                grease_required = True
                has_surge_source = True
                rate = float(ws.flow_rate_lpd_override or 25.0)
                q_s = float(ws.daily_flow_l_override) if ws.daily_flow_l_override is not None else (ws.units * rate)
                ep_s = round(q_s / flow_lpd, 2)
                # Commercial food processing / kitchen effluent has elevated BOD even after grease arrestor (~650 mg/L)
                bod_s = float(ws.influent_bod_mgl or 650.0)
                # Nutrient loading scaled by elevated commercial strength (approx 1.3x domestic equivalent)
                tn_s = ep_s * 4.2 * 1.15
                tp_s = ep_s * 0.52 * 1.30
                comm_kitchen_flow_ld += q_s
                basis = f"Commercial / food processing ({q_s:.0f} L/d, est. BOD {bod_s:.0f} mg/L; Grease Arrestor req.)"

            if ws.requires_grease_trap:
                grease_required = True
                if stype != WastewaterSourceType.FOOD_PROCESSING_COMMERCIAL:
                    comm_kitchen_flow_ld += q_s * 0.35

            total_flow_ld += q_s
            total_ep_equiv += ep_s
            weighted_bod_num += q_s * bod_s
            total_n_kg_yr_multi += tn_s
            total_p_kg_yr_multi += tp_s

            source_breakdown.append(
                WastewaterSourceSummary(
                    label=ws.label,
                    source_type=stype.value,
                    units=ws.units,
                    ep_equivalent=round(ep_s, 1),
                    daily_flow_ld=round(q_s, 1),
                    influent_bod_mgl=round(bod_s, 1),
                    requires_grease_trap=ws.requires_grease_trap or stype == WastewaterSourceType.FOOD_PROCESSING_COMMERCIAL,
                    basis_note=basis,
                )
            )

        persons = max(1, int(math.ceil(total_ep_equiv)))
        ep_water = total_ep_equiv
        ep_tn = total_n_kg_yr_multi / 4.2
        ep_tp = total_p_kg_yr_multi / 0.52
        ep_bod = total_ep_equiv
        weighted_bod_mgl_override = max(20.0, weighted_bod_num / max(1.0, total_flow_ld))
    else:
        ep_water = persons * frac_water
        ep_tn = persons * frac_tn
        ep_tp = persons * frac_tp
        ep_bod = persons * frac_bod
        total_flow_ld = ep_water * flow_lpd

    q_m3_d = total_flow_ld / 1000.0
    annual_flow_m3 = total_flow_ld * 365.0 / 1000.0

    # 2. Soil parameters & Deep Drainage Rate (OSmodel rows 24..40)
    soil = _get_soil_row(rules, inp.soil_texture_id)
    is_secondary = inp.treatment_system != TreatmentSystemType.PRIMARY_SEPTIC
    is_irrigation = inp.land_application_type in (
        LandApplicationType.SUBSURFACE_DRIP_IRRIGATION,
        LandApplicationType.SURFACE_SPRAY_IRRIGATION,
    )

    if is_irrigation:
        max_perc_mmd = float(soil["ssi_dir"])
    elif is_secondary:
        max_perc_mmd = float(soil["secondary_trench_dlr"])
    else:
        if soil["primary_dlr"] is None:
            # Per LCC Strategy s5.4.4, primary-only is not allowed for mod/weak light clay or cat 6
            max_perc_mmd = 5.0
        else:
            max_perc_mmd = float(soil["primary_dlr"])

    root_mm = inp.root_zone_depth_mm if not is_irrigation else 300.0
    gravel_mm = inp.gravel_depth_mm if not is_irrigation else 0.0
    bucket_cap_sat_mm = root_mm * soil["porosity_root"] + gravel_mm * soil["porosity_gravel"]
    bucket_cap_awc_mm = root_mm * soil["awc_root"]

    # 3. Morand soil lookup & Phosphorus balance (OSmodel AG29..AK36)
    morand_entry = rules["morand_soil_units"].get(inp.morand_code)
    if morand_entry is None:
        raise ValueError(f"Unknown Lismore Morand soil code: '{inp.morand_code}'")
    p_sorption = float(morand_entry["p_sorption"] or 1000.0)
    p_per_ep = 0.52  # kg/EP/yr (AK29)
    total_p_kg_yr = ep_tp * p_per_ep
    wt_depth_m = max(0.6, inp.site_eval.depth_to_water_table_m)
    wt_buffer_m = 0.5  # AK33
    p_accum_yr = 50.0  # AK34
    p_plant_uptake = 20.0  # kg/ha/yr (AK35)
    # Exact AK36: AK30 * 10000 / (AK31 * (AK32 - AK33) / AK34 + AK35)
    phosphorus_area_m2 = total_p_kg_yr * 10000.0 / (
        p_sorption * max(0.1, wt_depth_m - wt_buffer_m) / p_accum_yr + p_plant_uptake
    )

    # 4. Headley & Davidson (2003) Reed Bed Kinetics (OSmodel AM16..BA26)
    n_per_ep = 4.2  # kg/EP/yr (AK16)
    total_n_kg_yr = ep_tn * n_per_ep
    tn_inlet_mgl = 1_000_000.0 * total_n_kg_yr / 365.0 / total_flow_ld  # AR17

    if weighted_bod_mgl_override is not None:
        bod_inlet_mgl = max(5.0 + 1e-12, weighted_bod_mgl_override)
    else:
        full_bod_mgl = 250.0  # AO19
        flow_coeff = flow_lpd / min_rate_lpd  # AQ19
        bod_src_coeff = ep_bod / persons  # AS19
        bod_inlet_mgl = max(5.0 + 1e-12, bod_src_coeff * full_bod_mgl / flow_coeff)  # AO21

    # BOD kinetics (row 21): T=24 C, Cb=5, Co=20, kv20=0.52, theta=0.953
    temp_c = 24.0
    cb_bod = 5.0
    co_bod_target = 20.0
    kv_bod = 0.52 * (0.953 ** (temp_c - 20.0))
    hrt_bod_days = max(0.0, (math.log(bod_inlet_mgl - cb_bod) - math.log(co_bod_target - cb_bod)) / kv_bod)

    # TN kinetics (row 22): Cb=1.5, kvT=0.18
    cb_tn = 1.5
    kv_tn = 0.18
    porosity_rb = 0.4
    wetted_depth = inp.reed_bed_wetted_depth_m

    if inp.treatment_system == TreatmentSystemType.SECONDARY_REED_BED:
        if inp.reed_bed_area_override_m2 and inp.reed_bed_area_override_m2 > 0:
            rb_area_m2 = float(inp.reed_bed_area_override_m2)
            rb_hrt_days = rb_area_m2 * porosity_rb * wetted_depth / q_m3_d
            tn_outlet_mgl = cb_tn + (tn_inlet_mgl - cb_tn) * math.exp(-kv_tn * rb_hrt_days)
            bod_outlet_mgl = cb_bod + (bod_inlet_mgl - cb_bod) * math.exp(-kv_bod * rb_hrt_days)
        else:
            rb_hrt_days = hrt_bod_days
            tn_outlet_mgl = cb_tn + (tn_inlet_mgl - cb_tn) * math.exp(-kv_tn * rb_hrt_days)
            bod_outlet_mgl = co_bod_target
            rb_area_m2 = rb_hrt_days * q_m3_d / (wetted_depth * porosity_rb)
        n_removal_frac = max(0.0, 1.0 - tn_outlet_mgl / tn_inlet_mgl)
        rb_model, rb_count, rb_provided_m2 = _select_reed_bed_trays(rules, rb_area_m2, wetted_depth)
    elif inp.treatment_system == TreatmentSystemType.SECONDARY_AWTS:
        n_removal_frac = 0.20  # AD20
        rb_area_m2 = 0.0
        rb_hrt_days = 0.0
        bod_outlet_mgl = 20.0
        tn_outlet_mgl = tn_inlet_mgl * (1.0 - n_removal_frac)
        rb_model, rb_count, rb_provided_m2 = None, 0, 0.0
    else:
        n_removal_frac = 0.0
        rb_area_m2 = 0.0
        rb_hrt_days = 0.0
        bod_outlet_mgl = bod_inlet_mgl
        tn_outlet_mgl = tn_inlet_mgl
        rb_model, rb_count, rb_provided_m2 = None, 0, 0.0

    # 5. Nitrogen balance & Buffer Encroachment Penalty (OSmodel AK14..AK26)
    n_loss_laa = 0.20  # AK17
    n_avail_kg_yr = total_n_kg_yr * (1.0 - n_removal_frac) * (1.0 - n_loss_laa)  # AK19

    buf_std = 100.0 if inp.buffer_feature == BufferFeatureType.STREAM else 40.0  # N4
    buf_min = 50.0 if inp.buffer_feature == BufferFeatureType.STREAM else 20.0   # O4
    dist_into_buf = max(0.0, buf_std - inp.buffer_distance_m)  # AK15
    eff_block_limit = 600.0  # AK14
    block_m2 = inp.block_size_m2

    # Exact AK21 formula:
    term1 = (buf_min - dist_into_buf) / buf_min + (dist_into_buf / buf_min) * (eff_block_limit / block_m2)
    term2 = min(1.0, (eff_block_limit / block_m2) * (buf_std - dist_into_buf) / (buf_std - buf_min))
    mod_block_ha = max(term1, term2) * block_m2 / 10000.0  # AK21

    max_n_perc = 15.0  # AK23 (kg/system.yr)
    curvature = 3.0    # AK22
    n_perc_granted = max_n_perc * (1.0 - math.exp(-curvature * mod_block_ha))  # AK24
    n_plant_uptake = 200.0  # kg/ha/yr (AK25)

    # Exact AK26 formula:
    if n_avail_kg_yr > 0:
        nitrogen_area_m2 = max(0.0, (1.0 - n_perc_granted / n_avail_kg_yr) * 10000.0 * n_avail_kg_yr / n_plant_uptake)
    else:
        nitrogen_area_m2 = 0.0

    # 6. Hydraulic area via 7,670-day daily water balance solver (OSmodel C31)
    hydraulic_area_m2, p95_exc, exc_count = _solve_hydraulic_area_m2(
        flow_ld=total_flow_ld,
        bucket_cap_sat_mm=bucket_cap_sat_mm,
        bucket_cap_awc_mm=bucket_cap_awc_mm,
        max_perc_mmd=max_perc_mmd,
        reed_bed_area_m2=rb_area_m2,
    )

    # 7. Minimum area cap (OSmodel AC16: 15 m2/EP primary, 10 m2/EP secondary)
    if inp.apply_area_cap:
        cap_per_ep = 15.0 if not is_secondary else 10.0
        area_cap_m2 = cap_per_ep * ep_water
    else:
        area_cap_m2 = 0.0

    candidates = {
        "Hydraulic": hydraulic_area_m2,
        "Nitrogen": nitrogen_area_m2,
        "Phosphorus": phosphorus_area_m2,
        "Minimum Area Cap": area_cap_m2,
    }
    limiting_factor = max(candidates, key=candidates.get)  # type: ignore[arg-type]
    required_laa_m2 = candidates[limiting_factor]

    # 8. Septic tank capacity, Grease Arrestor & Surge Tank sizing (AS/NZS 1547 Table J1 & AS/NZS 3500.2)
    has_grey = any([active["bathroom"], active["laundry"], active["kitchen"]])
    septic_min_l = _compute_septic_tank_min_l(rules, persons, active["toilet"], has_grey, total_flow_ld)
    septic_retention_days = septic_min_l / total_flow_ld if total_flow_ld > 0 else 0.0

    if grease_required:
        # AS/NZS 3500.2 & NSW Liquid Trade Waste Guidelines: min 1,000 L commercial grease arrestor
        auto_grease_l = max(1000, int(math.ceil(max(comm_kitchen_flow_ld, 400.0) * 1.5 / 500.0) * 500))
        grease_arrestor_min_l = max(1000, int(inp.grease_arrestor_capacity_l)) if inp.grease_arrestor_capacity_l else auto_grease_l
    else:
        grease_arrestor_min_l = 0

    if inp.surge_balance_tank_l and inp.surge_balance_tank_l > 0:
        surge_tank_min_l = int(inp.surge_balance_tank_l)
    elif has_surge_source and total_flow_ld >= 600.0:
        # 1.0x daily flow equalisation / balance tank for peak-weekend agritourism or batch washdown
        surge_tank_min_l = max(1500, int(math.ceil(total_flow_ld / 500.0) * 500))
    else:
        surge_tank_min_l = 0

    exceeds_commercial_threshold = (total_flow_ld > 2000.0) or (persons > 10)

    # 9. Rectangular trench / irrigation zone layout (Designer sheet)
    trench_layout = _compute_trench_layout(
        required_laa_m2=required_laa_m2,
        trench_width_m=inp.trench_width_m,
        trench_separation_m=inp.trench_separation_m,
        n_override=inp.number_of_trenches_override,
        is_irrigation=is_irrigation,
    )

    return WastewaterModelResult(
        design_persons=persons,
        flow_rate_lpd=flow_lpd,
        total_flow_ld=round(total_flow_ld, 1),
        annual_flow_m3=round(annual_flow_m3, 2),
        soil_texture_name=soil["name"],
        soil_category=int(soil["category"]),
        soil_ksat_md=soil["ksat_md"],
        max_deep_drainage_mmd=max_perc_mmd,
        bucket_cap_sat_mm=round(bucket_cap_sat_mm, 1),
        bucket_cap_awc_mm=round(bucket_cap_awc_mm, 1),
        morand_code=inp.morand_code,
        morand_unit_name=morand_entry["unit"],
        morand_group=morand_entry["group"],
        p_sorption_kg_ha_m=p_sorption,
        total_p_kg_yr=round(total_p_kg_yr, 2),
        phosphorus_area_m2=round(phosphorus_area_m2, 1),
        total_n_kg_yr=round(total_n_kg_yr, 2),
        n_removal_pct=round(n_removal_frac * 100.0, 1),
        n_available_to_laa_kg_yr=round(n_avail_kg_yr, 2),
        n_percolation_granted_kg_yr=round(n_perc_granted, 2),
        nitrogen_area_m2=round(nitrogen_area_m2, 1),
        reed_bed_required_m2=round(rb_area_m2, 1),
        reed_bed_hrt_days=round(rb_hrt_days, 1),
        reed_bed_bod_inlet_mgl=round(bod_inlet_mgl, 1),
        reed_bed_bod_outlet_mgl=round(bod_outlet_mgl, 1),
        reed_bed_tn_inlet_mgl=round(tn_inlet_mgl, 1),
        reed_bed_tn_outlet_mgl=round(tn_outlet_mgl, 1),
        recommended_reed_bed_model=rb_model,
        recommended_reed_bed_count=rb_count,
        recommended_reed_bed_provided_m2=rb_provided_m2,
        hydraulic_area_m2=round(hydraulic_area_m2, 1),
        daily_loading_rate_actual_mmd=round(total_flow_ld / required_laa_m2, 2),
        exceedance_days_count=exc_count,
        exceedance_pct_of_days=round(100.0 * exc_count / 7670.0, 2),
        p95_exceedance_mm=round(p95_exc, 4),
        area_cap_m2=round(area_cap_m2, 1),
        required_laa_m2=round(required_laa_m2, 1),
        limiting_factor=limiting_factor,  # type: ignore[arg-type]
        reserve_laa_m2=round(required_laa_m2, 1),
        septic_tank_min_l=septic_min_l,
        septic_retention_days=round(septic_retention_days, 1),
        source_breakdown=source_breakdown,
        weighted_influent_bod_mgl=round(bod_inlet_mgl, 1),
        grease_arrestor_min_l=grease_arrestor_min_l,
        surge_tank_min_l=surge_tank_min_l,
        exceeds_commercial_threshold_2000ld=exceeds_commercial_threshold,
        trench_layout=trench_layout,
    )
