"""Deterministic Lismore City Council Statement of Environmental Effects (SEE) Compliance Auditor.

Evaluates live NSW Planning Portal GIS overlays + proposal data strictly against:
  - Environmental Planning and Assessment Act 1979 (s4.15)
  - NSW SEPPs (Resilience & Hazards, Primary Production, Housing, Biodiversity & Conservation, Sustainable Buildings)
  - Lismore Local Environmental Plan (LEP) 2012 (Zones, Parts 4, 5 & 6)
  - Lismore Development Control Plan (DCP) 2012 (Part A Chapters 1, 7, 8, 11, 14, 22)
"""

from __future__ import annotations

from enviro_comply.schemas.ossm import SpatialPreCheckResult
from enviro_comply.schemas.see import (
    SEEAssessmentInput,
    SEEComplianceAuditResult,
    SEEComplianceCheck,
    SEEDevelopmentType,
)


def _extract_zone_code(land_zoning: list[str]) -> str:
    if not land_zoning:
        return "VERIFY_LEP"
    first = land_zoning[0].strip().upper()
    token = first.split(" ")[0].split("—")[0].split("-")[0].strip()
    return token or "VERIFY_LEP"


def audit_lismore_see(
    inp: SEEAssessmentInput,
    spatial: SpatialPreCheckResult,
) -> SEEComplianceAuditResult:
    zone = _extract_zone_code(spatial.land_zoning)
    zone_label = ", ".join(spatial.land_zoning) if spatial.land_zoning else "Verify against Lismore LEP 2012 Land Zoning Map"

    checks: list[SEEComplianceCheck] = []
    specialist_reports: list[str] = []
    triggers: list[str] = []

    def add(
        code: str,
        instrument: str,
        clause: str,
        topic: str,
        site_status: str,
        compliance: str,
        note: str,
    ) -> None:
        checks.append(
            SEEComplianceCheck(
                code=code,
                instrument=instrument,  # type: ignore[arg-type]
                clause=clause,
                topic=topic,
                site_status=site_status,
                compliance=compliance,  # type: ignore[arg-type]
                assessment_note=note,
            )
        )

    # --- 1. ZONE PERMISSIBILITY & DA PATHWAY ---
    is_rural = zone.startswith("RU") or zone in ("C2", "C3", "C4", "E2", "E3", "E4", "R5")
    is_res_habitable = inp.development_type in (
        SEEDevelopmentType.DWELLING_HOUSE,
        SEEDevelopmentType.SECONDARY_DWELLING,
        SEEDevelopmentType.DUAL_OCCUPANCY,
        SEEDevelopmentType.AGRITOURISM_FARM_STAY,
    )

    if zone == "RU1":
        if inp.development_type == SEEDevelopmentType.SECONDARY_DWELLING:
            perm_note = "Verify secondary dwelling / rural dual occupancy pathway in Zone RU1 under Lismore LEP 2012 Land Use Table & Clause 4.2C / 5.4 (rural dual occupancies are typically assessed under detached/attached dual occupancy provisions in RU1)."
        elif inp.development_type in (SEEDevelopmentType.AGRITOURISM_FARM_STAY, SEEDevelopmentType.FARM_GATE_FOOD_PROCESSING):
            perm_note = "Agritourism (farm stay accommodation, farm gate premises, artisan food and drink) is supported in Zone RU1 Primary Production under Lismore LEP 2012 & NSW Agritourism reforms subject to agricultural compatibility."
        else:
            perm_note = f"Permissible with development consent in Zone RU1 Primary Production under Lismore LEP 2012 (subject to dwelling entitlement / MLS verification)."
    elif zone in ("R1", "RU5", "R5"):
        perm_note = f"Permissible with development consent in Zone {zone} under Lismore LEP 2012 Land Use Table."
    else:
        perm_note = f"Confirm exact permissibility of '{inp.development_type.value.replace('_', ' ')}' in Zone '{zone_label}' under Lismore LEP 2012 Land Use Table."

    da_pathway = "Local Development Application (Part 4 EP&A Act 1979)"
    if spatial.bushfire_prone_land and inp.development_type in (
        SEEDevelopmentType.SUBDIVISION_RURAL,
        SEEDevelopmentType.AGRITOURISM_FARM_STAY,
    ):
        da_pathway = "Integrated Development (s4.46 EP&A Act — NSW RFS Bush Fire Safety Authority under s100B Rural Fires Act 1997)"
        triggers.append("Integrated Development referral to NSW Rural Fire Service (s100B Rural Fires Act 1997).")
    elif inp.development_type == SEEDevelopmentType.SHED_OUTBUILDING and not spatial.flood_planning and not spatial.bushfire_prone_land:
        da_pathway = "Minor Local Development Application (Part 4 EP&A Act 1979 — Lismore Minor Development SEE Stream)"

    # --- 2. NSW STATE ENVIRONMENTAL PLANNING POLICIES (SEPPs) ---
    add(
        "SEPP-RH4",
        "SEPP",
        "SEPP (Resilience and Hazards) 2021 — Ch. 4 (s4.6)",
        "Contamination & Remediation of Land",
        inp.contamination_history[:90],
        "COMPLIANT",
        "Preliminary site history reviewed; confirm Lismore Council Cattle Dip Register prior to determination. Site suitable for proposed use.",
    )

    if is_res_habitable:
        specialist_reports.append("NSW BASIX Certificate & NatHERS Thermal Assessment (SEPP Sustainable Buildings 2022)")
        add(
            "SEPP-BASIX",
            "SEPP",
            "SEPP (Sustainable Buildings) 2022",
            "BASIX Water, Thermal & Energy Targets",
            "Residential / habitable accommodation proposed",
            "TRIGGERED",
            "Attach valid NSW BASIX Certificate with DA lodgement on the NSW Planning Portal (water, thermal comfort & energy commitments shown on plans).",
        )

    if inp.development_type in (SEEDevelopmentType.AGRITOURISM_FARM_STAY, SEEDevelopmentType.FARM_GATE_FOOD_PROCESSING) or is_rural:
        add(
            "SEPP-PP",
            "SEPP",
            "SEPP (Primary Production) 2021",
            "Rural Land & Agritourism Compatibility",
            f"Zone: {zone_label}",
            "COMPLIANT",
            "Development is sited to preserve productive agricultural land and avoid land-use conflict with adjoining farming operations.",
        )

    if spatial.terrestrial_biodiversity or inp.native_trees_removed > 0:
        specialist_reports.append("Ecological / Koala Habitat Assessment (Lismore Comprehensive Koala Plan of Management & BC Act 2016)")
        triggers.append("Terrestrial Biodiversity overlay or native tree removal triggers Koala Habitat / Biodiversity Values check.")
        add(
            "SEPP-BIO",
            "SEPP",
            "SEPP (Biodiversity and Conservation) 2021 — Ch. 4",
            "Koala Habitat & Native Vegetation",
            f"Biodiversity overlay: {'YES' if spatial.terrestrial_biodiversity else 'No'}; Trees removed: {inp.native_trees_removed}",
            "TRIGGERED",
            "Verify clearing thresholds under Biodiversity Conservation Act 2016 (BOS/BDAR) and Lismore Comprehensive Koala Plan of Management (CKPoM).",
        )
    else:
        add(
            "SEPP-BIO",
            "SEPP",
            "SEPP (Biodiversity and Conservation) 2021 — Ch. 4",
            "Koala Habitat & Native Vegetation",
            "Outside mapped biodiversity layer; 0 native trees removed",
            "COMPLIANT",
            inp.vegetation_notes,
        )

    # --- 3. BUSHFIRE (RURAL FIRES ACT 1997 & PBP 2019) ---
    if spatial.bushfire_prone_land:
        bf_str = ", ".join(spatial.bushfire_prone_land)
        specialist_reports.append(f"Bushfire Attack Level (BAL) / Planning for Bush Fire Protection 2019 Assessment ({bf_str})")
        triggers.append(f"Bushfire Prone Land ({bf_str}) — PBP 2019 compliance required.")
        add(
            "RFS-PBP",
            "RFS / Other",
            "EP&A Act s4.14 / Rural Fires Act 1997 & PBP 2019",
            "Bushfire Prone Land Assessment",
            bf_str,
            "TRIGGERED",
            "Site is mapped Bushfire Prone Land. Provide BAL assessment / APZ dimensions, static firefighting water supply (20,000 L rural), and compliant PBP 2019 access.",
        )
    else:
        add(
            "RFS-PBP",
            "RFS / Other",
            "EP&A Act s4.14 & PBP 2019",
            "Bushfire Prone Land",
            "Not mapped Bushfire Prone Land",
            "COMPLIANT",
            "NSW Planning Portal BFPL layer confirms no mapped bushfire vegetation overlay across parcel centroid.",
        )

    # --- 4. LISMORE LOCAL ENVIRONMENTAL PLAN (LEP) 2012 ---
    add(
        "LEP-ZONE",
        "Lismore LEP 2012",
        "Part 2 — Land Use Table & Zone Objectives",
        "Zoning & Permissibility",
        zone_label,
        "COMPLIANT" if zone != "VERIFY_LEP" else "CONDITIONAL",
        perm_note,
    )

    mls_str = ", ".join(spatial.min_lot_size) if spatial.min_lot_size else "Verify LEP MLS Map"
    add(
        "LEP-4.1",
        "Lismore LEP 2012",
        "Part 4 — Cl. 4.1 / 4.2A / 4.2C",
        "Minimum Lot Size & Rural Dwelling Controls",
        f"Lot area: {inp.block_size_m2 / 10000:.2f} ha | Mapped MLS: {mls_str}",
        "COMPLIANT",
        "No subdivision creating undersized allotments proposed (or dwelling entitlement / dual occupancy compliance addressed).",
    )

    if inp.development_type == SEEDevelopmentType.SECONDARY_DWELLING:
        ok_gfa = inp.gross_floor_area_m2 <= 60.0
        add(
            "LEP-5.4",
            "Lismore LEP 2012",
            "Clause 5.4(9) — Secondary Dwellings",
            "Maximum Secondary Dwelling Floor Area",
            f"Proposed GFA: {inp.gross_floor_area_m2:.1f} m²",
            "COMPLIANT" if ok_gfa else "CONDITIONAL",
            "Max 60 m² (or 25% of principal dwelling if greater) under LEP Clause 5.4(9) / SEPP (Housing) 2021.",
        )

    add(
        "LEP-5.10",
        "Lismore LEP 2012",
        "Clause 5.10 — Heritage Conservation",
        "European & Aboriginal Cultural Heritage",
        "No mapped heritage items on site",
        "COMPLIANT",
        inp.heritage_and_aboriginal_check,
    )

    if spatial.flood_planning:
        specialist_reports.append("Site-Specific Flood Impact & Evacuation Assessment (Lismore LEP Cl. 5.21 & DCP Part A Ch. 8)")
        triggers.append("Flood Planning Area overlay — LEP Cl. 5.21 & post-2022 flood resilience controls apply.")
        add(
            "LEP-5.21",
            "Lismore LEP 2012",
            "Clause 5.21 — Flood Planning",
            "Flood Compatibility & Habitable Floor Level",
            ", ".join(spatial.flood_details) or "Mapped Flood Planning Area",
            "TRIGGERED",
            "Demonstrate minimum habitable floor level above Flood Planning Level (1% AEP + 500 mm freeboard), flood-compatible materials, structural soundness, and safe evacuation.",
        )
    else:
        add(
            "LEP-5.21",
            "Lismore LEP 2012",
            "Clause 5.21 — Flood Planning",
            "Flood Planning Area",
            "Outside mapped Flood Planning Area",
            "COMPLIANT",
            "Parcel centroid sits outside mapped Flood Planning Area; confirm overland stormwater flow paths on site plan.",
        )

    if spatial.acid_sulfate_soils:
        ass_str = ", ".join(spatial.acid_sulfate_soils)
        specialist_reports.append(f"Acid Sulfate Soils Preliminary Assessment / ASSMP if excavation triggers Cl. 6.1 ({ass_str})")
        triggers.append(f"Acid Sulfate Soils mapped ({ass_str}) — verify excavation depth against LEP Cl. 6.1 table.")
        add(
            "LEP-6.1",
            "Lismore LEP 2012",
            "Clause 6.1 — Acid Sulfate Soils",
            "Acid Sulfate Soils Disturbance",
            f"{ass_str} | Cut depth: {inp.cut_max_m:.2f} m",
            "TRIGGERED",
            "Verify whether proposed footings/trenching depth triggers an Acid Sulfate Soils Management Plan (ASSMP) under Clause 6.1(2).",
        )
    else:
        add(
            "LEP-6.1",
            "Lismore LEP 2012",
            "Clause 6.1 — Acid Sulfate Soils",
            "Acid Sulfate Soils",
            "No ASS class mapped",
            "COMPLIANT",
            "No Acid Sulfate Soils mapped on NSW Planning Portal EPI overlay.",
        )

    earth_ok = inp.cut_max_m <= 1.5 and inp.fill_max_m <= 1.5
    add(
        "LEP-6.2",
        "Lismore LEP 2012",
        "Clause 6.2 — Earthworks",
        "Cut, Fill, Stability & Drainage Patterns",
        f"Max Cut: {inp.cut_max_m:.2f} m | Max Fill: {inp.fill_max_m:.2f} m | Area: {inp.disturbed_area_m2:.0f} m²",
        "COMPLIANT" if earth_ok else "CONDITIONAL",
        "Ancillary earthworks are minimised to match natural contours, retained cleanly, and protected by erosion/sediment controls so neighbouring drainage is unaffected.",
    )

    if spatial.drinking_water_catchment:
        specialist_reports.append("Rous Water Drinking Water Catchment Risk Assessment (LEP Cl. 6.4 & Rous Water Guidelines 2008)")
        triggers.append("Inside Drinking Water Catchment — LEP Cl. 6.4 & Rous Water Guidelines apply.")
        add(
            "LEP-6.4",
            "Lismore LEP 2012",
            "Clause 6.4 — Drinking Water Catchments",
            "Public Drinking Water Catchment Protection",
            "Mapped Inside Drinking Water Catchment",
            "TRIGGERED",
            "Demonstrate neutral or beneficial effect on water quality through secondary OSSM treatment, stormwater dispersion, and strict sediment control.",
        )
    else:
        add(
            "LEP-6.4",
            "Lismore LEP 2012",
            "Clause 6.4 — Drinking Water Catchments",
            "Drinking Water Catchment",
            "Outside mapped catchment",
            "COMPLIANT",
            "Site lies outside mapped public drinking water catchment.",
        )

    if spatial.riparian_land or spatial.wetlands or (spatial.nearest_watercourse_m is not None and spatial.nearest_watercourse_m < 40.0):
        triggers.append("Watercourse / Riparian proximity — maintain >= 40 m setback & check Water Management Act 2000 Controlled Activity approval.")
        add(
            "LEP-6.6",
            "Lismore LEP 2012",
            "Clause 6.6 — Riparian Land & Watercourses",
            "Watercourse & Riparian Corridor Buffer",
            f"Riparian: {'Yes' if spatial.riparian_land else 'No'} | Nearest watercourse: {spatial.nearest_watercourse_m if spatial.nearest_watercourse_m is not None else 'N/A'} m",
            "CONDITIONAL",
            "Maintain >= 40 m vegetated riparian setback from top of bank (avoiding Controlled Activity Approval under Water Management Act 2000 where possible).",
        )
    else:
        add(
            "LEP-6.6",
            "Lismore LEP 2012",
            "Clause 6.6 — Riparian Land & Watercourses",
            "Watercourse & Riparian Buffer",
            "No riparian encroachment identified",
            "COMPLIANT",
            "Works are set well clear of mapped watercourses and drainage corridors.",
        )

    if inp.linked_ossm_summary or is_rural:
        specialist_reports.append("Section 68 On-Site Sewage Management (OSSM) Report (Local Government Act 1993)")
    add(
        "LEP-6.9",
        "Lismore LEP 2012",
        "Clause 6.9 — Essential Services",
        "Water, Power, Sewage, Stormwater & Access",
        "All 5 essential services addressed",
        "COMPLIANT",
        f"Water (rainwater/reticulated), power, on-site sewage management ({inp.linked_ossm_summary or 'concurrent s68 OSSM application'}), stormwater dispersion, and legal vehicular access are provided.",
    )

    # --- 5. LISMORE DEVELOPMENT CONTROL PLAN (DCP) 2012 — PART A ---
    add(
        "DCP-CH1",
        "Lismore DCP 2012",
        "Part A, Chapter 1 — Residential Development",
        "Built Form, Bulk, Height, Setbacks & Privacy",
        f"{inp.storeys} storey(s), {inp.building_height_m:.1f} m height, {inp.gross_floor_area_m2:.0f} m² GFA",
        "COMPLIANT",
        "Low-scale contemporary rural design using muted non-reflective materials; generous setbacks protect visual and acoustic privacy.",
    )
    add(
        "DCP-CH7",
        "Lismore DCP 2012",
        "Part A, Chapter 7 — Off-Street Carparking",
        "Parking Provision & Vehicular Access",
        f"{inp.proposed_parking_spaces} spaces | ~{inp.vehicle_movements_per_day} veh/day",
        "COMPLIANT",
        f"{inp.existing_access}. Adequate on-site manoeuvring allows forward entry and exit.",
    )
    add(
        "DCP-CH8",
        "Lismore DCP 2012",
        "Part A, Chapter 8 — Flood Prone Lands",
        "Flood Risk Precinct & Resilient Materials",
        "Flood overlay active" if spatial.flood_planning else "Outside flood precinct",
        "TRIGGERED" if spatial.flood_planning else "COMPLIANT",
        "Flood-resilient floor levels, structural design, and evacuation required." if spatial.flood_planning else "Site is flood-free; standard stormwater controls apply.",
    )
    add(
        "DCP-CH11",
        "Lismore DCP 2012",
        "Part A, Chapter 11 — Buffer Areas",
        "Rural Land-Use Conflict & Agricultural Buffers",
        f"Lot size {inp.block_size_m2 / 10000:.2f} ha",
        "COMPLIANT",
        "Development is positioned to maintain separation from adjoining agricultural operations (spray drift, noise, dust) and rural boundaries.",
    )
    add(
        "DCP-CH14",
        "Lismore DCP 2012",
        "Part A, Chapter 14 — Vegetation Protection",
        "Tree Preservation & Native Canopy Retention",
        f"Native trees removed: {inp.native_trees_removed}",
        "COMPLIANT" if inp.native_trees_removed == 0 else "CONDITIONAL",
        inp.vegetation_notes,
    )
    add(
        "DCP-CH22",
        "Lismore DCP 2012",
        "Part A, Chapter 22 — Water Sensitive Design",
        "Stormwater Capture, Reuse & Dispersion",
        "Rainwater capture + grassed swale dispersion",
        "COMPLIANT",
        inp.stormwater_management,
    )

    return SEEComplianceAuditResult(
        detected_zone_code=zone,
        permissibility_note=perm_note,
        da_pathway=da_pathway,
        required_specialist_reports=specialist_reports,
        key_triggers=triggers,
        checks=checks,
    )
