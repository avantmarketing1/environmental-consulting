"""Deterministic Lismore City Council OSSM Strategy (2013) compliance auditor.

Evaluates every Site Limitation (Table 6), Soil Limitation (Table 7), Buffer Distance (s5.4.1f),
Borehole Requirement (s5.4.3), Treatment Train & Land Application rule (Appendix A & B),
and Spatial Planning Overlay (Drinking Water Catchment / Flood / Acid Sulfate Soils).
"""

from __future__ import annotations

from enviro_comply.engine.lismore_model import load_lismore_rules
from enviro_comply.schemas.ossm import (
    ComplianceAuditResult,
    ComplianceCheckItem,
    LandApplicationType,
    SiteAssessmentInput,
    SpatialPreCheckResult,
    TreatmentSystemType,
    WastewaterModelResult,
)


def audit_lismore_compliance(
    inp: SiteAssessmentInput,
    spatial: SpatialPreCheckResult,
    model: WastewaterModelResult,
) -> ComplianceAuditResult:
    rules = load_lismore_rules()
    bufs = rules["buffers_m"]
    limits = rules["design_limits"]
    se = inp.site_eval

    checks: list[ComplianceCheckItem] = []
    departures: list[str] = []
    site_limitations = False
    soil_limitations = False
    needs_secondary = False
    needs_gypsum = False

    def add(
        code: str,
        category: str,
        parameter: str,
        measured: str,
        requirement: str,
        clause: str,
        status: str,
        mitigation: str | None = None,
    ) -> None:
        nonlocal site_limitations, soil_limitations
        checks.append(
            ComplianceCheckItem(
                code=code,
                category=category,  # type: ignore[arg-type]
                parameter=parameter,
                measured_value=measured,
                requirement=requirement,
                clause=clause,
                status=status,  # type: ignore[arg-type]
                mitigation=mitigation,
            )
        )
        if status in ("LIMITATION", "FAIL"):
            if category in ("Site", "Buffers", "Planning"):
                site_limitations = True
            elif category == "Soil":
                soil_limitations = True

    # --- 1. SITE LIMITATIONS (Table 6) ---
    is_eta = inp.land_application_type == LandApplicationType.ETA_BEDS
    if se.slope_pct > limits["eta_max_slope_pct"]:
        needs_secondary = True
        st = "FAIL" if is_eta else "LIMITATION"
        mit = "Secondary treatment + sub-surface irrigation or engineered retaining/terracing required."
        if is_eta:
            departures.append(f"Site slope ({se.slope_pct}%) exceeds 15% maximum for ETA beds (Strategy Table 6 & Appendix B s3.0).")
        add("SITE-SLOPE", "Site", "Slope Angle", f"{se.slope_pct}%", "< 15% for ETA beds", "LCC Strategy 2013 Table 6", st, mit)
    else:
        add("SITE-SLOPE", "Site", "Slope Angle", f"{se.slope_pct}%", "< 15% for ETA beds", "LCC Strategy 2013 Table 6", "PASS")

    if se.landform == "convergent":
        add(
            "SITE-LANDFORM", "Site", "Landform", se.landform_notes,
            "Divergent or planar (water-shedding)", "LCC Strategy 2013 Table 6", "LIMITATION",
            "Construct upslope diversion bund/swale above the land application area.",
        )
    else:
        add("SITE-LANDFORM", "Site", "Landform", se.landform_notes, "Divergent or planar", "LCC Strategy 2013 Table 6", "PASS")

    aspect_upper = se.aspect.upper()
    if any(q in aspect_upper for q in ("SOUTH", "SW", "SE")) or se.exposure == "low_sheltered":
        add(
            "SITE-EXPOSURE", "Site", "Aspect & Exposure", f"{se.aspect} ({se.exposure} exposure)",
            "NW/NE quadrant with high sun-wind exposure", "LCC Strategy 2013 Table 6", "LIMITATION",
            "Encourage vigorous perennial grass cover and downslope Lomandra hystrix uptake row; trim overhanging shade trees.",
        )
    else:
        add("SITE-EXPOSURE", "Site", "Aspect & Exposure", f"{se.aspect} ({se.exposure} exposure)", "NW/NE quadrant, high exposure", "LCC Strategy 2013 Table 6", "PASS")

    if se.below_1_in_20_flood or se.below_1_in_100_flood or spatial.flood_planning:
        mit = "Locate treatment system above 1-in-100 year flood level and pump/locate LAA above 1-in-20 year flood level."
        departures.append("Site intersects flood planning overlay or flood contour constraint (Strategy s5.4.1(h)).")
        add("SITE-FLOOD", "Site", "Flooding Potential", se.flooding_potential, "LAA > 1:20 yr; Treatment > 1:100 yr", "LCC Strategy 2013 s5.4.1(h) & Table 6", "LIMITATION", mit)
    else:
        add("SITE-FLOOD", "Site", "Flooding Potential", se.flooding_potential, "LAA > 1:20 yr; Treatment > 1:100 yr", "LCC Strategy 2013 s5.4.1(h) & Table 6", "PASS")

    if se.surface_dampness or se.waterlogging_present:
        needs_secondary = True
        add("SITE-DRAIN", "Site", "Site Drainage & Waterlogging", f"{se.site_drainage}; {se.waterlogging_vegetation}", "No dampness or waterlogging indicator species", "LCC Strategy 2013 Table 6", "LIMITATION", "Provide secondary treatment and upslope diversion drainage.")
    else:
        add("SITE-DRAIN", "Site", "Site Drainage & Waterlogging", f"{se.site_drainage}; {se.waterlogging_vegetation}", "No dampness or sedges", "LCC Strategy 2013 Table 6", "PASS")

    if se.surface_cracking_or_bare:
        needs_secondary = True
        add("SITE-SURF", "Site", "Surface Condition", se.surface_condition, "Grassed, no bare ground or cracking", "LCC Strategy 2013 Table 6", "LIMITATION", "Secondary treatment and establish perennial grass cover over LAA.")
    else:
        add("SITE-SURF", "Site", "Surface Condition", se.surface_condition, "Grassed, no bare ground or cracking", "LCC Strategy 2013 Table 6", "PASS")

    if se.contains_fill:
        add("SITE-FILL", "Site", "Fill", se.fill_notes, "Disposal area not on uncontrolled fill", "LCC Strategy 2013 s5.4.1(l) & Table 6", "LIMITATION", "Relocate LAA off fill or provide geotechnical certification.")
    else:
        add("SITE-FILL", "Site", "Fill", se.fill_notes, "No uncontrolled fill", "LCC Strategy 2013 s5.4.1(l) & Table 6", "PASS")

    if se.erosion_present:
        add("SITE-EROSION", "Site", "Erosion / Mass Movement", se.erosion_notes, "No rills, slips, or mass movement", "LCC Strategy 2013 Table 6", "LIMITATION", "Stabilise with deep-rooted vegetation and upslope runoff diversion.")
    else:
        add("SITE-EROSION", "Site", "Erosion / Mass Movement", se.erosion_notes, "No rills, slips, or mass movement", "LCC Strategy 2013 Table 6", "PASS")

    # --- 2. BUFFER DISTANCES (s5.4.1f & Table 6) ---
    if se.dist_perennial_watercourse_m is not None:
        req = bufs["perennial_or_intermittent_watercourse"]["required_m"]
        if se.dist_perennial_watercourse_m < req:
            needs_secondary = True
            departures.append(f"LAA is {se.dist_perennial_watercourse_m} m from perennial/intermittent watercourse (< {req} m buffer).")
            add("BUF-WATER", "Buffers", "Perennial/Intermittent Watercourse", f"{se.dist_perennial_watercourse_m} m", f">= {req} m", bufs["perennial_or_intermittent_watercourse"]["clause"], "LIMITATION", "Maximise buffer distance and provide secondary treatment (with disinfection if required).")
        else:
            add("BUF-WATER", "Buffers", "Perennial/Intermittent Watercourse", f"{se.dist_perennial_watercourse_m} m", f">= {req} m", bufs["perennial_or_intermittent_watercourse"]["clause"], "PASS")
    elif spatial.nearest_watercourse_m is not None:
        req = bufs["perennial_or_intermittent_watercourse"]["required_m"]
        st = "PASS" if spatial.nearest_watercourse_m >= req else "INFO"
        add("BUF-WATER-GIS", "Buffers", "Nearest Mapped Watercourse (Parcel Edge)", f"{spatial.nearest_watercourse_m:.1f} m", f">= {req} m from LAA", bufs["perennial_or_intermittent_watercourse"]["clause"], st, "Confirm exact LAA-to-watercourse setback on site plan.")

    if se.dist_gully_m is not None:
        req = bufs["gully_ephemeral"]["required_m"]
        if se.dist_gully_m < req:
            needs_secondary = True
            departures.append(f"LAA is {se.dist_gully_m} m from ephemeral gully (< {req} m buffer).")
            add("BUF-GULLY", "Buffers", "Gully / Ephemeral Stream", f"{se.dist_gully_m} m", f">= {req} m", bufs["gully_ephemeral"]["clause"], "LIMITATION", "Maximise buffer and provide secondary treatment.")
        else:
            add("BUF-GULLY", "Buffers", "Gully / Ephemeral Stream", f"{se.dist_gully_m} m", f">= {req} m", bufs["gully_ephemeral"]["clause"], "PASS")

    if se.dist_domestic_bore_m is not None:
        req = bufs["domestic_groundwater_bore"]["required_m"]
        st = "PASS" if se.dist_domestic_bore_m >= req else "LIMITATION"
        if st == "LIMITATION":
            needs_secondary = True
            departures.append(f"LAA is {se.dist_domestic_bore_m} m from domestic groundwater bore (< {req} m buffer).")
        add("BUF-BORE", "Buffers", "Domestic Groundwater Bore/Well", f"{se.dist_domestic_bore_m} m", f">= {req} m", bufs["domestic_groundwater_bore"]["clause"], st)

    if se.dist_property_boundary_m is not None:
        if is_eta:
            key = "property_boundary_eta_downgradient" if se.boundary_is_downgradient else "property_boundary_eta_upgradient"
        else:
            key = "property_boundary_ssi_downgradient" if se.boundary_is_downgradient else "property_boundary_ssi_upgradient"
        req = bufs[key]["required_m"]
        st = "PASS" if se.dist_property_boundary_m >= req else "LIMITATION"
        if st == "LIMITATION":
            needs_secondary = True
            departures.append(f"LAA setback to property boundary ({se.dist_property_boundary_m} m) is below {req} m requirement.")
        add("BUF-BOUNDARY", "Buffers", "Property Boundary Setback", f"{se.dist_property_boundary_m} m", f">= {req} m", bufs[key]["clause"], st)

    if se.septic_to_dwelling_m is not None:
        req = bufs["septic_tank_to_building"]["required_m"]
        st = "PASS" if se.septic_to_dwelling_m >= req else "FAIL"
        add("BUF-SEPTIC", "Buffers", "Septic Tank to Building", f"{se.septic_to_dwelling_m} m", f"> {req} m", bufs["septic_tank_to_building"]["clause"], st)

    # --- 3. SOIL LIMITATIONS (Table 7 & s5.4.2) ---
    morand = rules["morand_soil_units"].get(inp.morand_code, {})
    if morand.get("unsuitable"):
        departures.append(f"Morand soil unit '{morand.get('unit')}' ({inp.morand_code}) is flagged unsuitable for standard effluent disposal (Strategy Table 1).")
        add("SOIL-MORAND", "Soil", "Morand (1994) Soil Unit", f"{morand.get('unit')} ({inp.morand_code})", "Suitable soil landscape", "LCC Strategy 2013 Table 1", "FAIL", morand.get("limitations"))
    else:
        add("SOIL-MORAND", "Soil", "Morand (1994) Soil Unit", f"{morand.get('unit', inp.morand_code)} ({inp.morand_code}) — P-sorption {model.p_sorption_kg_ha_m:,.0f} kg/ha/m", "Identify desktop soil unit & limitations", "LCC Strategy 2013 s5.4.2 Table 1", "PASS", morand.get("limitations"))

    # Borehole count & depth check (Strategy p.35: minimum 2 boreholes to >= 1000mm)
    n_bh = len(inp.boreholes)
    min_depth_mm = min((bh.max_depth_mm for bh in inp.boreholes), default=0)
    if n_bh < limits["min_boreholes"] or min_depth_mm < limits["min_borehole_depth_mm"]:
        departures.append(
            f"Borehole assessment has {n_bh} borehole(s) (min depth {min_depth_mm} mm); Lismore Strategy s5.4.3 requires minimum 2 boreholes to >= 1000 mm."
        )
        add(
            "SOIL-BOREHOLES", "Soil", "Borehole Coverage & Depth",
            f"{n_bh} borehole(s), min depth {min_depth_mm} mm",
            ">= 2 boreholes to >= 1000 mm depth",
            "LCC Strategy 2013 s5.4.2(h) & s5.4.3 p.35",
            "LIMITATION",
            "Complete second borehole to >= 1000 mm across LAA high/low points prior to lodgement.",
        )
    else:
        add("SOIL-BOREHOLES", "Soil", "Borehole Coverage & Depth", f"{n_bh} boreholes, min depth {min_depth_mm} mm", ">= 2 boreholes to >= 1000 mm", "LCC Strategy 2013 s5.4.3 p.35", "PASS")

    # Inspect all horizons for pH, dispersive class, coarse fragments
    all_horizons = [h for bh in inp.boreholes for h in bh.horizons]
    worst_disp = max((h.dispersive_class for h in all_horizons if h.dispersive_class is not None), default=1)
    min_ph = min((h.ph for h in all_horizons if h.ph is not None), default=6.5)
    max_cf = max((h.coarse_fragments_pct for h in all_horizons), default=0.0)

    if worst_disp >= 3:
        needs_secondary = True
        needs_gypsum = True
        add(
            "SOIL-DISP", "Soil", "Dispersiveness (Modified Emerson SAR 5)",
            f"Class {worst_disp}", "Class 1 or 2 (non-dispersive)",
            "LCC Strategy 2013 s5.4.2(g) & Table 7", "LIMITATION",
            "Provide secondary treatment and ameliorate disposal area base with gypsum at 1.0 kg/m2; recommend low-sodium detergents.",
        )
    else:
        add("SOIL-DISP", "Soil", "Dispersiveness (Modified Emerson SAR 5)", f"Class {worst_disp}", "Class 1 or 2", "LCC Strategy 2013 s5.4.2(g) & Table 7", "PASS")

    if min_ph <= limits["ideal_ph_min"]:
        needs_secondary = True
        add(
            "SOIL-PH", "Soil", "Field pH", f"{min_ph:.1f}", "> 5.5 (ideal 6.5 - 8.0)",
            "LCC Strategy 2013 s5.4.2(f) & Table 7", "LIMITATION",
            "Secondary treatment; condition topsoil with agricultural lime if pH < 5.5 to assist plant nutrient uptake.",
        )
    else:
        add("SOIL-PH", "Soil", "Field pH", f"{min_ph:.1f}", "> 5.5", "LCC Strategy 2013 s5.4.2(f) & Table 7", "PASS")

    if max_cf > 20.0:
        add(
            "SOIL-COARSE", "Soil", "Coarse Fragments", f"{max_cf:.0f}%", "< 20% of soil volume",
            "LCC Strategy 2013 Table 5 & Table 7", "LIMITATION",
            "Increase Soil Category by one class if larger pores are absent.",
        )
    else:
        add("SOIL-COARSE", "Soil", "Coarse Fragments", f"{max_cf:.0f}%", "< 20% of soil volume", "LCC Strategy 2013 Table 5 & Table 7", "PASS")

    if model.soil_category >= 6:
        needs_secondary = True
        add(
            "SOIL-CAT", "Soil", "Soil Category (Most Limiting Layer)", f"Category {model.soil_category} ({model.soil_texture_name})",
            "Categories 1-5", "LCC Strategy 2013 s5.4.4 & Table 7", "LIMITATION",
            "Secondary treatment required; ameliorate dispersive clays with gypsum and model conservatively.",
        )
    else:
        add("SOIL-CAT", "Soil", "Soil Category (Most Limiting Layer)", f"Category {model.soil_category} ({model.soil_texture_name})", "Categories 1-5", "LCC Strategy 2013 Table 4 & Table 7", "PASS")

    if se.depth_to_water_table_m < 1.0:
        needs_secondary = True
        add("SOIL-DEPTH", "Soil", "Depth to Water Table / Bedrock", f"{se.depth_to_water_table_m:.1f} m", ">= 1.0 m", "LCC Strategy 2013 s5.4.2(h) & Table 7", "LIMITATION", "Secondary treatment with disinfection and shallow sub-surface irrigation or mound system.")
    else:
        add("SOIL-DEPTH", "Soil", "Depth to Water Table / Bedrock", f"{se.depth_to_water_table_m:.1f} m", ">= 1.0 m", "LCC Strategy 2013 s5.4.2(h) & Table 7", "PASS")

    # --- 4. TREATMENT & LAND APPLICATION RULES ---
    trt_labels = {
        "primary_septic": "Primary Septic Tank",
        "secondary_reed_bed": "Secondary Rigid Reed Bed",
        "secondary_awts": "Secondary AWTS",
        "secondary_generic": "Secondary Treatment",
    }
    trt_label = trt_labels.get(inp.treatment_system.value, inp.treatment_system.value)
    is_secondary = inp.treatment_system != TreatmentSystemType.PRIMARY_SEPTIC
    if needs_secondary and not is_secondary:
        departures.append("Site/soil limitations trigger secondary treatment, but Primary-only system is nominated.")
        add("TRT-LEVEL", "Treatment", "Treatment Level", trt_label, "Secondary treatment required", "LCC Strategy 2013 Tables 6 & 7", "FAIL", "Upgrade to Reed Bed or NSW Health accredited AWTS.")
    else:
        add("TRT-LEVEL", "Treatment", "Treatment Level", trt_label, "Appropriate for site/soil class", "LCC Strategy 2013 Appendix A", "PASS")

    if inp.treatment_system == TreatmentSystemType.SECONDARY_REED_BED:
        if model.reed_bed_hrt_days < limits["reed_bed_min_hrt_days_secondary"]:
            departures.append(f"Reed bed HRT ({model.reed_bed_hrt_days} d) is below 5-day minimum for secondary treatment.")
            add("TRT-RB-HRT", "Treatment", "Reed Bed Hydraulic Retention Time", f"{model.reed_bed_hrt_days} days", ">= 5.0 days (7.0 days standard)", "LCC Strategy 2013 Appendix A s4.0", "FAIL", "Increase reed bed tray area or wetted depth.")
        else:
            st = "PASS" if model.reed_bed_hrt_days >= 5.0 else "LIMITATION"
            add("TRT-RB-HRT", "Treatment", "Reed Bed Hydraulic Retention Time", f"{model.reed_bed_hrt_days} days (N removal {model.n_removal_pct}%)", ">= 5.0 days & >= 50% N removal", "LCC Strategy 2013 Appendix A s4.0 & Reed Bed Guide s3.0", st)

    if is_eta:
        if model.trench_layout.exceeds_max_length_20m:
            departures.append(f"ETA bed length ({model.trench_layout.trench_length_m} m) exceeds 20 m maximum (Appendix B Design 1).")
            add("LAA-LEN", "Land Application", "ETA Bed Length", f"{model.trench_layout.trench_length_m} m", "<= 20.0 m (centrally fed)", "LCC Strategy 2013 Appendix B Design 1", "FAIL", "Split LAA into additional parallel trenches separated by >= 2.0 m.")
        else:
            add("LAA-LEN", "Land Application", "ETA Bed Length", f"{model.trench_layout.trench_length_m} m", "<= 20.0 m (centrally fed)", "LCC Strategy 2013 Appendix B Design 1", "PASS")

        if model.trench_layout.exceeds_3_trenches:
            add("LAA-TRENCHES", "Land Application", "Number of ETA Trenches", str(model.trench_layout.number_of_trenches), "<= 3 via distribution box", "LCC Strategy 2013 Appendix B s3.0", "LIMITATION", "Use indexing valve / dosing manifold rather than passive distribution box.")
        else:
            add("LAA-TRENCHES", "Land Application", "Number of ETA Trenches", str(model.trench_layout.number_of_trenches), "<= 3 via distribution box", "LCC Strategy 2013 Appendix B s3.0", "PASS")
    else:
        add("LAA-ZONE", "Land Application", "Contiguous Irrigation Zone", f"{model.trench_layout.trench_length_m} m × {model.trench_layout.trench_width_m} m ({model.required_laa_m2} m²)", "Tertiary disinfected effluent + CIDP", "LCC Strategy 2013 Appendix B s4.0", "PASS")

    if not se.reserve_laa_available:
        departures.append("No alternate (reserve) land application area nominated (Strategy s1.1).")
        add("LAA-RESERVE", "Land Application", "Reserve LAA", "Not available", f">= {model.reserve_laa_m2} m2 nominated", "LCC Strategy 2013 Part B s1.1", "FAIL")
    else:
        add("LAA-RESERVE", "Land Application", "Reserve LAA", f"Available (>= {model.reserve_laa_m2} m2)", "Alternate reserve LAA nominated", "LCC Strategy 2013 Part B s1.1", "PASS")

    # --- 5. PLANNING OVERLAYS (Rous Water, ASS, Irrigation Certification) ---
    requires_cidp = inp.land_application_type in (
        LandApplicationType.SUBSURFACE_DRIP_IRRIGATION,
        LandApplicationType.SURFACE_SPRAY_IRRIGATION,
    )
    if spatial.drinking_water_catchment:
        departures.append("Property lies within a mapped Drinking Water Catchment — Rous Water On-site Wastewater Management Guidelines (2008) apply.")
        add("PLAN-DWC", "Planning", "Drinking Water Catchment", "Mapped Inside Catchment", "Comply with Rous Water Guidelines (2008)", "LCC Strategy 2013 Part B s1.1 & s5.1", "LIMITATION", "Include Rous Water Guidelines risk assessment and enhanced pathogen/nutrient barriers.")
    else:
        add("PLAN-DWC", "Planning", "Drinking Water Catchment", "Outside mapped catchment", "Rous Water Guidelines if inside", "LCC Strategy 2013 Part B s1.1", "PASS")

    if spatial.acid_sulfate_soils:
        add("PLAN-ASS", "Planning", "Acid Sulfate Soils (ASS)", ", ".join(spatial.acid_sulfate_soils), "Check ASS Risk Map for excavation", "LCC Strategy 2013 s5.4.2(i)", "LIMITATION", "Limit excavation depth and prepare ASS management notes if below threshold.")
    else:
        add("PLAN-ASS", "Planning", "Acid Sulfate Soils (ASS)", "None mapped", "Check ASS Risk Map", "LCC Strategy 2013 s5.4.2(i)", "PASS")

    if requires_cidp:
        add("PLAN-CIDP", "Land Application", "Certified Irrigation Design Plan (CIDP)", "Irrigation nominated", "Appendix C & D certified by CID", "LCC Strategy 2013 Part B s1.1 & Appendix B s4.0", "LIMITATION", "Attach Certified Irrigation Design Plan (A3 1:200 & 1:250) with Appendix C & D checklists.")

    # --- 6. MULTI-USE / AGRITOURISM / COMMERCIAL & GREASE ARRESTOR CHECKS ---
    requires_grease = model.grease_arrestor_min_l > 0
    requires_commercial = model.exceeds_commercial_threshold_2000ld or any(
        s.source_type == "food_processing_commercial" for s in model.source_breakdown
    )

    if requires_grease:
        add(
            "COMM-GREASE",
            "Commercial",
            "Commercial Grease Arrestor (FOG Pre-Treatment)",
            f"{model.grease_arrestor_min_l} L Grease Arrestor nominated",
            ">= 1,000 L pre-treatment prior to septic/secondary tank",
            "AS/NZS 3500.2 & NSW Liquid Trade Waste Guidelines",
            "PASS",
            "Pump out grease arrestor every 3–6 months via licensed liquid waste contractor; retain dockets for Council.",
        )

    if model.surge_tank_min_l > 0:
        add(
            "COMM-SURGE",
            "Commercial",
            "Flow Equalisation / Surge Balance Tank",
            f"{model.surge_tank_min_l} L Balance Tank nominated",
            "Attenuate peak weekend / batch hydraulic surges",
            "AS/NZS 1547:2012 Appendix H & LCC Strategy s5.3",
            "PASS",
            "Time-dose treated/primary effluent evenly across 24 hours to prevent hydraulic shock to reed bed and LAA.",
        )

    if model.exceeds_commercial_threshold_2000ld:
        departures.append(
            f"Combined daily design flow ({model.total_flow_ld:.0f} L/d; {model.design_persons} EP) exceeds single-household "
            f"2,000 L/d / 10 EP threshold — commercial/multi-use engineering review & NSW Health commercial accreditation check required."
        )
        add(
            "COMM-FLOW",
            "Commercial",
            "Commercial / Multi-Use Flow Threshold",
            f"{model.total_flow_ld:.0f} L/day ({model.design_persons} EP)",
            "<= 2,000 L/d or <= 10 EP for standard domestic pathway",
            "LCC Strategy 2013 Part A s1.2 & NSW Health Accreditation",
            "LIMITATION",
            "Provide commercial-scale treatment specification, surge equalisation, and Council pre-lodgement consultation.",
        )

    return ComplianceAuditResult(
        site_has_limitations=site_limitations,
        soil_has_limitations=soil_limitations,
        overall_no_limitations=not (site_limitations or soil_limitations),
        requires_secondary_treatment=needs_secondary,
        requires_gypsum=needs_gypsum,
        gypsum_rate_kg_m2=1.0 if needs_gypsum else 0.0,
        requires_rous_water_assessment=spatial.drinking_water_catchment,
        requires_certified_irrigation_design=requires_cidp,
        requires_grease_arrestor=requires_grease,
        requires_commercial_assessment=requires_commercial,
        departures_from_strategy=departures,
        checks=checks,
    )
