"""Pydantic schemas for Lismore City Council Statement of Environmental Effects (SEE) reports.

Aligned with Environmental Planning and Assessment Act 1979 (s4.15), Lismore Local Environmental Plan (LEP) 2012,
Lismore Development Control Plan (DCP) 2012 (Part A), and relevant NSW SEPPs.
"""

from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field

from enviro_comply.schemas.ossm import ConsultantDetails


class SEEDevelopmentType(str, Enum):
    DWELLING_HOUSE = "dwelling_house"
    SECONDARY_DWELLING = "secondary_dwelling"
    DUAL_OCCUPANCY = "dual_occupancy"
    SHED_OUTBUILDING = "shed_outbuilding"
    AGRITOURISM_FARM_STAY = "agritourism_farm_stay"
    FARM_GATE_FOOD_PROCESSING = "farm_gate_food_processing"
    SUBDIVISION_RURAL = "subdivision_rural"
    COMMERCIAL_CHANGE_OF_USE = "commercial_change_of_use"
    OTHER = "other"


class SEECustomNarratives(BaseModel):
    executive_summary: Optional[str] = None
    site_and_locality_context: Optional[str] = None
    proposal_details_narrative: Optional[str] = None
    statutory_zone_justification: Optional[str] = None
    environmental_impacts_and_mitigation: Optional[str] = None
    site_suitability_and_public_interest: Optional[str] = None
    source_documents_summary: Optional[str] = None
    ai_model_used: Optional[str] = None


class SEEAssessmentInput(BaseModel):
    project_ref: str = "FTF-SEE-001"
    assessment_date: date = Field(default_factory=date.today)
    applicant_name: str
    site_address: str
    lot_number: str
    plan_label: str
    lga: str = "Lismore City Council"
    block_size_m2: float = Field(default=10000.0, gt=0.0)

    # Proposal specifics
    development_type: SEEDevelopmentType = SEEDevelopmentType.DWELLING_HOUSE
    proposal_title: str = "Proposed Rural Residential / Ancillary Development"
    proposal_summary: str = ""
    estimated_cost_aud: float = Field(default=350000.0, ge=0.0)
    gross_floor_area_m2: float = Field(default=180.0, ge=0.0)
    building_height_m: float = Field(default=5.8, ge=0.0)
    storeys: int = Field(default=1, ge=1, le=5)
    materials_and_colours: str = "Colorbond corrugated metal roof (muted woodland tones), timber/fibre-cement cladding, aluminium glazing"
    existing_use_and_structures: str = "Rural allotment with existing farm access track, pasture cover, and scattered native vegetation"

    # Earthworks & Vegetation
    cut_max_m: float = Field(default=0.8, ge=0.0)
    fill_max_m: float = Field(default=0.6, ge=0.0)
    disturbed_area_m2: float = Field(default=450.0, ge=0.0)
    native_trees_removed: int = Field(default=0, ge=0)
    vegetation_notes: str = "Sited in cleared pasture area avoiding remnant native vegetation and Koala feed trees"

    # Access, Parking & Operations
    existing_access: str = "Existing rural vehicular crossover onto sealed/formed public road with compliant sightlines"
    proposed_parking_spaces: int = Field(default=2, ge=0)
    vehicle_movements_per_day: int = Field(default=6, ge=0)
    operating_hours: Optional[str] = None
    staff_or_guests_max: Optional[str] = None

    # Services, Hazards & Amenity
    water_supply_method: str = "On-site rainwater harvesting tanks (minimum 45,000 L domestic + dedicated 20,000 L static bushfire reserve where applicable)"
    electricity_and_comms: str = "Connection to existing rural electricity supply / off-grid solar battery system and wireless telecommunications"
    stormwater_management: str = "Roof water captured to rainwater tanks with overflow directed via level spreader to grassed dispersion swale (zero increase in peak runoff)"
    wastewater_management_summary: str = "On-site Sewage Management System (OSSM) subject to concurrent Section 68 Local Government Act 1993 approval"
    construction_waste_and_escp: str = "Silt fences downslope of all earthworks, stabilised site entry, skip bin waste segregation (recyclables/timber/general), and prompt grass stabilisation"
    neighbour_amenity_notes: str = "Generous rural setbacks ensure zero overshadowing, zero acoustic nuisance, and retention of rural visual character"
    heritage_and_aboriginal_check: str = "No mapped heritage items on site; standard unexpected finds protocol adopted for all earthworks"
    contamination_history: str = "No known historical cattle dip sites, underground fuel storage, or contaminating industrial uses observed on site; verify Council cattle dip register"

    # Optional OSSM cross-reference & AI narratives
    linked_ossm_summary: Optional[str] = None
    custom_narratives: Optional[SEECustomNarratives] = None
    consultant: ConsultantDetails = Field(
        default_factory=lambda: ConsultantDetails(
            name="Field To Forest Environmental Consulting",
            qualification="Environmental & Planning Consultant (Northern Rivers NSW)",
            licence_number="FTF-NSW",
            company="Field To Forest",
            email="consulting@fieldtoforestfarm.com",
            postal_address="Lismore NSW 2480",
        )
    )


class SEEComplianceCheck(BaseModel):
    code: str
    instrument: Literal["EP&A Act 1979", "SEPP", "Lismore LEP 2012", "Lismore DCP 2012", "RFS / Other"]
    clause: str
    topic: str
    site_status: str
    compliance: Literal["COMPLIANT", "CONDITIONAL", "TRIGGERED", "N/A"]
    assessment_note: str


class SEEComplianceAuditResult(BaseModel):
    detected_zone_code: str
    permissibility_note: str
    da_pathway: str
    required_specialist_reports: list[str] = Field(default_factory=list)
    key_triggers: list[str] = Field(default_factory=list)
    checks: list[SEEComplianceCheck] = Field(default_factory=list)
