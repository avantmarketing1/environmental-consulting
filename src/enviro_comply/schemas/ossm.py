from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator


class WaterSupplyType(str, Enum):
    RETICULATED_STANDARD = "reticulated_standard"
    RETICULATED_FULL_WATER_SAVING = "reticulated_full_water_saving"
    ROOF_STANDARD = "roof_standard"
    ROOF_FULL_WATER_SAVING = "roof_full_water_saving"


class TreatmentSystemType(str, Enum):
    PRIMARY_SEPTIC = "primary_septic"
    SECONDARY_AWTS = "secondary_awts"
    SECONDARY_REED_BED = "secondary_reed_bed"
    SECONDARY_GENERIC = "secondary_generic"


class LandApplicationType(str, Enum):
    ETA_BEDS = "eta_beds"
    SUBSURFACE_DRIP_IRRIGATION = "subsurface_drip_irrigation"
    SURFACE_SPRAY_IRRIGATION = "surface_spray_irrigation"


class BufferFeatureType(str, Enum):
    STREAM = "stream"  # Perennial or intermittent watercourse (100m buffer)
    GULLY = "gully"    # Dry gully / ephemeral stream (40m buffer)


class DevelopmentCategory(str, Enum):
    SINGLE_DWELLING = "single_dwelling"
    DUAL_OCCUPANCY = "dual_occupancy"
    AGRITOURISM_CABINS = "agritourism_cabins"
    FOOD_PROCESSING_COMMERCIAL = "food_processing_commercial"
    MIXED_FARM_DEVELOPMENT = "mixed_farm_development"


class WastewaterSourceType(str, Enum):
    DWELLING = "dwelling"
    SECONDARY_DWELLING = "secondary_dwelling"
    AGRITOURISM_CABIN = "agritourism_cabin"
    DAY_VISITORS_AMENITIES = "day_visitors_amenities"
    FOOD_PROCESSING_COMMERCIAL = "food_processing_commercial"


class WastewaterSource(BaseModel):
    label: str = Field(..., examples=["Primary Dwelling", "Eco-Cabins (x3)", "On-Farm Food Processing Shed"])
    source_type: WastewaterSourceType = WastewaterSourceType.DWELLING
    units: int = Field(default=1, ge=1, description="Number of dwellings, cabins, or daily visitor/batch units")
    bedrooms_per_unit: int = Field(default=2, ge=0, description="Bedrooms per dwelling/cabin (ignored for day visitors/food processing)")
    guests_per_unit: Optional[int] = Field(default=None, ge=1, description="Override EP/guests per unit (e.g. 2 guests/cabin)")
    flow_rate_lpd_override: Optional[float] = Field(default=None, ge=5.0, description="Optional L/unit/d override (AS/NZS 1547 Table H2)")
    daily_flow_l_override: Optional[float] = Field(default=None, ge=0.0, description="Direct daily flow in L/day (e.g. washdown/batch processing)")
    influent_bod_mgl: Optional[float] = Field(default=None, ge=50.0, le=3000.0, description="Optional BOD5 concentration mg/L (default 250 domestic, 650 food processing)")
    requires_grease_trap: bool = False
    peak_surge_factor: float = Field(default=1.0, ge=1.0, le=3.0)


class WastewaterSourceSummary(BaseModel):
    label: str
    source_type: str
    units: int
    ep_equivalent: float
    daily_flow_ld: float
    influent_bod_mgl: float
    requires_grease_trap: bool = False
    basis_note: str = ""


class CustomReportNarratives(BaseModel):
    executive_summary: Optional[str] = None
    development_context: Optional[str] = None
    system_selection_justification: Optional[str] = None
    commercial_trade_waste_notes: Optional[str] = None
    site_soil_interpretation: Optional[str] = None
    departure_mitigations: Optional[str] = None
    custom_om_notes: Optional[str] = None
    source_documents_summary: Optional[str] = None
    ai_model_used: Optional[str] = None


class ConsultantDetails(BaseModel):
    name: str
    qualification: str = "Accredited Wastewater Consultant"
    licence_number: Optional[str] = None
    company: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    postal_address: Optional[str] = None


class WastewaterComponents(BaseModel):
    toilet: bool = True
    bathroom: bool = True
    laundry: bool = True
    kitchen: bool = True


class BoreholeHorizon(BaseModel):
    horizon: str = Field(..., examples=["A", "B", "C"])
    depth_top_mm: int = Field(ge=0)
    depth_bottom_mm: int = Field(gt=0)
    classification: str = Field(..., examples=["Topsoil", "Clay loam", "Light clay"])
    texture_moist: str = Field(default="")
    structure_moist: str = Field(..., examples=["weak", "moderate", "strong", "massive"])
    colour: str = Field(..., examples=["Dark brown", "Red-brown"])
    coarse_fragments_pct: float = Field(default=0.0, ge=0.0, le=100.0)
    ph: Optional[float] = Field(default=None, ge=3.0, le=11.0)
    dispersive_class: Optional[int] = Field(default=None, ge=1, le=4)
    is_disposal_level: bool = False


class BoreholeLog(BaseModel):
    borehole_id: str = Field(default="BH1")
    easting_mga56: Optional[float] = None
    northing_mga56: Optional[float] = None
    bolus_ribbon_mm: Optional[str] = None
    bolus_description: Optional[str] = None
    depth_to_bedrock_m: Optional[float] = None
    depth_to_water_table_m: Optional[float] = None
    horizons: list[BoreholeHorizon] = Field(default_factory=list)

    @property
    def max_depth_mm(self) -> int:
        return max((h.depth_bottom_mm for h in self.horizons), default=0)


class SiteEvaluationFieldData(BaseModel):
    assessment_date: date
    recent_weather: str = "Dry with intermittent showers"
    existing_system_notes: Optional[str] = None
    existing_vegetation: str = "Mixed native shrubs, scattered trees and grass cover"
    slope_pct: float = Field(ge=0.0, le=60.0)
    slope_range_text: Optional[str] = None
    landform: Literal["divergent", "linear_planar", "convergent"] = "linear_planar"
    landform_notes: str = "Linear planar slope across proposed disposal area"
    aspect: str = Field(..., examples=["North", "North-East", "South-West"])
    exposure: Literal["high", "medium", "low_sheltered"] = "medium"
    boulders_rocks: str = "Minor surface floaters; no limiting rock outcrops"
    boulders_limiting: bool = False
    flooding_potential: str = "None (well above 1-in-20 and 1-in-100 year flood levels)"
    below_1_in_20_flood: bool = False
    below_1_in_100_flood: bool = False
    site_drainage: str = "Good; no channelled runoff or surface dampness observed"
    surface_dampness: bool = False
    waterlogging_vegetation: str = "No sedges or bullrushes observed"
    waterlogging_present: bool = False
    surface_condition: str = "Grassed with no cracking or ponding"
    surface_cracking_or_bare: bool = False
    fill_notes: str = "None"
    contains_fill: bool = False
    erosion_notes: str = "No rills, slips, or mass movement observed"
    erosion_present: bool = False
    depth_to_water_table_m: float = Field(default=3.0, gt=0.0)
    run_on_diversion_proposed: str = "Construct an upslope run-on diversion swale above the disposal field"
    run_off_control_proposed: str = "Establish a double row of Lomandra hystrix (1 m offset spacing) downslope of the ETA bed"
    reserve_laa_available: bool = True
    # Measured distances from LAA (metres)
    dist_perennial_watercourse_m: Optional[float] = None
    dist_gully_m: Optional[float] = None
    dist_domestic_bore_m: Optional[float] = None
    dist_property_boundary_m: Optional[float] = None
    boundary_is_downgradient: bool = True
    dist_dwelling_m: Optional[float] = None
    septic_to_dwelling_m: Optional[float] = None
    dist_nearest_small_tree_m: Optional[float] = None


class FieldPin(BaseModel):
    label: str
    feature_type: Literal[
        "dwelling",
        "septic_tank",
        "grease_arrestor",
        "reed_bed",
        "pump_well",
        "eta_bed",
        "reserve_laa",
        "borehole",
        "tree",
        "water_tank",
        "swale",
        "custom",
    ]
    # Local metres relative to dwelling centre (0,0) OR real GDA2020 MGA56 coordinates
    local_x_m: float = 0.0
    local_y_m: float = 0.0
    width_m: Optional[float] = None
    length_m: Optional[float] = None
    rotation_deg: float = 0.0
    easting_mga56: Optional[float] = None
    northing_mga56: Optional[float] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class SitePhoto(BaseModel):
    caption: str
    file_path: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class SiteAssessmentInput(BaseModel):
    project_ref: str = "LCC-OSSM-001"
    applicant_name: str
    site_address: str
    lot_number: str
    plan_label: str = Field(..., examples=["DP123456"])
    section_number: Optional[str] = None
    lga: str = "Lismore City Council"
    is_multiple_occupancy: bool = False
    multiple_occupancy_name: Optional[str] = None
    hia_area_m2: Optional[float] = None
    block_size_m2: float = Field(gt=0.0)
    development_description: str = "Combined Secondary On-Site Wastewater Treatment and Disposal System"
    development_category: DevelopmentCategory = DevelopmentCategory.SINGLE_DWELLING
    pin_map_backdrop: Literal["vector", "aerial"] = "vector"
    wastewater_sources: list[WastewaterSource] = Field(default_factory=list)
    grease_arrestor_required: bool = False
    grease_arrestor_capacity_l: Optional[int] = Field(default=None, ge=0)
    surge_balance_tank_l: Optional[int] = Field(default=None, ge=0)
    custom_narratives: Optional[CustomReportNarratives] = None
    bedrooms: int = Field(ge=1)
    persons_override: Optional[int] = Field(default=None, ge=1)
    water_supply: WaterSupplyType = WaterSupplyType.ROOF_FULL_WATER_SAVING
    wastewater_components: WastewaterComponents = Field(default_factory=WastewaterComponents)
    treatment_system: TreatmentSystemType = TreatmentSystemType.SECONDARY_REED_BED
    land_application_type: LandApplicationType = LandApplicationType.ETA_BEDS
    buffer_feature: BufferFeatureType = BufferFeatureType.GULLY
    buffer_distance_m: float = Field(default=40.0, ge=0.0)
    # Soil / model parameters
    morand_code: str = Field(..., min_length=2, max_length=2, examples=["co", "cl", "ge"])
    soil_texture_id: int = Field(
        default=9,
        ge=1,
        le=15,
        description="1..15 index matching LCC OSmodel Table 4 (e.g., 6=Clay loam high/mod, 9=Light clay strong)",
    )
    reed_bed_wetted_depth_m: float = Field(default=0.7, ge=0.3, le=1.2)
    reed_bed_area_override_m2: Optional[float] = None
    root_zone_depth_mm: float = Field(default=300.0, ge=100.0, le=500.0)
    gravel_depth_mm: float = Field(default=300.0, ge=0.0, le=500.0)
    trench_width_m: float = Field(default=2.0, ge=0.5, le=4.0)
    trench_separation_m: float = Field(default=2.0, ge=2.0, le=5.0)
    number_of_trenches_override: Optional[int] = Field(default=None, ge=1, le=6)
    apply_area_cap: bool = True
    # Field data
    site_eval: SiteEvaluationFieldData
    boreholes: list[BoreholeLog] = Field(default_factory=list)
    consultant: ConsultantDetails
    field_pins: list[FieldPin] = Field(default_factory=list)
    photos: list[SitePhoto] = Field(default_factory=list)

    @property
    def design_persons(self) -> int:
        # LCC Strategy s1.1 & s5.3: minimum persons = bedrooms + 1
        min_persons = self.bedrooms + 1
        if self.persons_override is not None:
            return max(min_persons, self.persons_override)
        return min_persons

    @model_validator(mode="after")
    def normalize_plan_label(self) -> "SiteAssessmentInput":
        self.plan_label = self.plan_label.replace(" ", "").upper()
        self.morand_code = self.morand_code.strip().lower()
        return self


class SpatialPreCheckResult(BaseModel):
    lot_id_string: str
    fetched_live: bool = False
    crs_epsg: int = 7856
    crs_name: str = "GDA2020 / MGA zone 56"
    parcel_area_m2: Optional[float] = None
    parcel_area_ha: Optional[float] = None
    centroid_lat: Optional[float] = None
    centroid_lon: Optional[float] = None
    centroid_easting_mga56: Optional[float] = None
    centroid_northing_mga56: Optional[float] = None
    parcel_geometry_mga56: Optional[dict[str, Any]] = None
    neighbour_parcels_mga56: list[dict[str, Any]] = Field(default_factory=list)
    watercourses_mga56: list[dict[str, Any]] = Field(default_factory=list)
    contours_mga56: list[dict[str, Any]] = Field(default_factory=list)
    # Planning overlays
    land_zoning: list[str] = Field(default_factory=list)
    min_lot_size: list[str] = Field(default_factory=list)
    flood_planning: bool = False
    flood_details: list[str] = Field(default_factory=list)
    landslide_risk: bool = False
    acid_sulfate_soils: list[str] = Field(default_factory=list)
    drinking_water_catchment: bool = False
    groundwater_vulnerability: bool = False
    riparian_land: bool = False
    wetlands: bool = False
    terrestrial_biodiversity: bool = False
    bushfire_prone_land: list[str] = Field(default_factory=list)
    nearest_watercourse_m: Optional[float] = None
    estimated_slope_pct: Optional[float] = None
    pre_site_flags: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class TrenchLayoutResult(BaseModel):
    laa_m2: float
    number_of_trenches: int
    trench_width_m: float
    trench_separation_m: float
    trench_length_m: float
    total_bed_area_m2: float
    envelope_width_m: float
    envelope_length_m: float
    envelope_area_m2: float
    exceeds_max_length_20m: bool = False
    exceeds_3_trenches: bool = False


class WastewaterModelResult(BaseModel):
    design_persons: int
    flow_rate_lpd: float
    total_flow_ld: float
    annual_flow_m3: float
    # Soil / drainage
    soil_texture_name: str
    soil_category: int
    soil_ksat_md: str
    max_deep_drainage_mmd: float
    bucket_cap_sat_mm: float
    bucket_cap_awc_mm: float
    # Morand / Phosphorus
    morand_code: str
    morand_unit_name: str
    morand_group: str
    p_sorption_kg_ha_m: float
    total_p_kg_yr: float
    phosphorus_area_m2: float
    # Nitrogen
    total_n_kg_yr: float
    n_removal_pct: float
    n_available_to_laa_kg_yr: float
    n_percolation_granted_kg_yr: float
    nitrogen_area_m2: float
    # Reed Bed (Headley & Davidson 2003)
    reed_bed_required_m2: float
    reed_bed_hrt_days: float
    reed_bed_bod_inlet_mgl: float
    reed_bed_bod_outlet_mgl: float
    reed_bed_tn_inlet_mgl: float
    reed_bed_tn_outlet_mgl: float
    recommended_reed_bed_model: Optional[str] = None
    recommended_reed_bed_count: int = 0
    recommended_reed_bed_provided_m2: float = 0.0
    # Hydraulic daily water balance (7,670 days)
    hydraulic_area_m2: float
    daily_loading_rate_actual_mmd: float
    exceedance_days_count: int
    exceedance_pct_of_days: float
    p95_exceedance_mm: float
    # Final sizing
    area_cap_m2: float
    required_laa_m2: float
    limiting_factor: Literal["Hydraulic", "Nitrogen", "Phosphorus", "Minimum Area Cap"]
    reserve_laa_m2: float
    # Septic tank
    septic_tank_min_l: int
    septic_retention_days: float
    # Multi-use / Commercial / Grease Arrestor / Surge Tank
    source_breakdown: list[WastewaterSourceSummary] = Field(default_factory=list)
    weighted_influent_bod_mgl: float = 250.0
    grease_arrestor_min_l: int = 0
    surge_tank_min_l: int = 0
    exceeds_commercial_threshold_2000ld: bool = False
    # Trench geometry
    trench_layout: TrenchLayoutResult


class ComplianceCheckItem(BaseModel):
    code: str
    category: Literal["Site", "Soil", "Buffers", "Treatment", "Land Application", "Planning", "Commercial"]
    parameter: str
    measured_value: str
    requirement: str
    clause: str
    status: Literal["PASS", "LIMITATION", "FAIL", "INFO"]
    mitigation: Optional[str] = None


class ComplianceAuditResult(BaseModel):
    site_has_limitations: bool
    soil_has_limitations: bool
    overall_no_limitations: bool
    requires_secondary_treatment: bool
    requires_gypsum: bool
    gypsum_rate_kg_m2: float = 0.0
    requires_rous_water_assessment: bool = False
    requires_certified_irrigation_design: bool = False
    requires_grease_arrestor: bool = False
    requires_commercial_assessment: bool = False
    departures_from_strategy: list[str] = Field(default_factory=list)
    checks: list[ComplianceCheckItem] = Field(default_factory=list)


class OSSMReportBundle(BaseModel):
    input: SiteAssessmentInput
    spatial: SpatialPreCheckResult
    model: WastewaterModelResult
    audit: ComplianceAuditResult
    generated_files: dict[str, str] = Field(default_factory=dict)
