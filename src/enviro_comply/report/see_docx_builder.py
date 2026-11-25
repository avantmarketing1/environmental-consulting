"""Council-ready Microsoft Word (.docx) Statement of Environmental Effects (SEE) Generator
for Lismore City Council Development Applications (EP&A Act 1979 s4.15, Lismore LEP 2012 & DCP 2012).

Pure python-docx (no matplotlib dependency) so it runs identically in Python CLI and Browser Pyodide.
"""

from __future__ import annotations

from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn
from docx.shared import Inches, Pt, RGBColor

from enviro_comply.schemas.ossm import SpatialPreCheckResult
from enviro_comply.schemas.see import SEEAssessmentInput, SEEComplianceAuditResult

NAVY = RGBColor(0x0D, 0x24, 0x1B)
ACCENT_BLUE = RGBColor(0x03, 0x69, 0xA1)
SLATE = RGBColor(0x33, 0x41, 0x55)
MUTED = RGBColor(0x64, 0x74, 0x8B)
GREEN = RGBColor(0x16, 0x65, 0x34)
AMBER = RGBColor(0x92, 0x40, 0x0E)
RED = RGBColor(0x99, 0x1B, 0x1B)


def _shade_cell(cell, hex_fill: str) -> None:
    shading = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{hex_fill}"/>')
    cell._tc.get_or_add_tcPr().append(shading)


def _set_table_borders(table, color: str = "CBD5E1") -> None:
    tbl_pr = table._tbl.tblPr
    borders = parse_xml(
        f'<w:tblBorders {nsdecls("w")}>'
        f'<w:top w:val="single" w:sz="6" w:space="0" w:color="{color}"/>'
        f'<w:left w:val="single" w:sz="4" w:space="0" w:color="{color}"/>'
        f'<w:bottom w:val="single" w:sz="6" w:space="0" w:color="{color}"/>'
        f'<w:right w:val="single" w:sz="4" w:space="0" w:color="{color}"/>'
        f'<w:insideH w:val="single" w:sz="4" w:space="0" w:color="{color}"/>'
        f'<w:insideV w:val="single" w:sz="4" w:space="0" w:color="{color}"/>'
        f"</w:tblBorders>"
    )
    tbl_pr.append(borders)


def _add_heading(doc: Document, text: str, level: int = 1) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14 if level == 1 else 10)
    p.paragraph_format.space_after = Pt(5)
    p.paragraph_format.keep_with_next = True
    run = p.add_run(text)
    run.bold = True
    run.font.name = "Calibri"
    run.font.size = Pt(14 if level == 1 else 11.5)
    run.font.color.rgb = NAVY if level <= 2 else ACCENT_BLUE
    if level == 1:
        pPr = p._p.get_or_add_pPr()
        pBdr = parse_xml(
            f'<w:pBdr {nsdecls("w")}><w:bottom w:val="single" w:sz="8" w:space="3" w:color="143628"/></w:pBdr>'
        )
        pPr.append(pBdr)


def _add_callout(doc: Document, title: str, body: str, fill_hex: str = "F0FDF4", border_hex: str = "166534") -> None:
    tbl = doc.add_table(rows=1, cols=1)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = tbl.rows[0].cells[0]
    cell.width = Inches(6.7)
    _shade_cell(cell, fill_hex)
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = parse_xml(
        f'<w:tcBorders {nsdecls("w")}>'
        f'<w:top w:val="single" w:sz="4" w:space="0" w:color="{border_hex}"/>'
        f'<w:left w:val="single" w:sz="18" w:space="0" w:color="{border_hex}"/>'
        f'<w:bottom w:val="single" w:sz="4" w:space="0" w:color="{border_hex}"/>'
        f'<w:right w:val="single" w:sz="4" w:space="0" w:color="{border_hex}"/>'
        f"</w:tcBorders>"
    )
    tc_pr.append(borders)
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(5)
    p.paragraph_format.space_after = Pt(5)
    rt = p.add_run(f"{title}: ")
    rt.bold = True
    rt.font.size = Pt(9.5)
    rt.font.color.rgb = NAVY
    rb = p.add_run(body)
    rb.font.size = Pt(9.5)
    rb.font.color.rgb = SLATE


def _add_kv_table(doc: Document, rows: list[tuple[str, str]], col_widths=(2.3, 4.4)) -> None:
    tbl = doc.add_table(rows=len(rows), cols=2)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    _set_table_borders(tbl)
    for idx, (k, v) in enumerate(rows):
        row = tbl.rows[idx]
        c0, c1 = row.cells[0], row.cells[1]
        c0.width = Inches(col_widths[0])
        c1.width = Inches(col_widths[1])
        _shade_cell(c0, "F1F5F9")
        p0 = c0.paragraphs[0]
        p0.paragraph_format.space_before = Pt(3)
        p0.paragraph_format.space_after = Pt(3)
        r0 = p0.add_run(k)
        r0.bold = True
        r0.font.size = Pt(9.2)
        r0.font.color.rgb = NAVY

        p1 = c1.paragraphs[0]
        p1.paragraph_format.space_before = Pt(3)
        p1.paragraph_format.space_after = Pt(3)
        r1 = p1.add_run(v)
        r1.font.size = Pt(9.2)
        r1.font.color.rgb = SLATE


def _add_grid_table(doc: Document, headers: list[str], rows: list[list[str]], status_col: int | None = None) -> None:
    tbl = doc.add_table(rows=len(rows) + 1, cols=len(headers))
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    _set_table_borders(tbl)
    hdr_row = tbl.rows[0]
    for j, h in enumerate(headers):
        cell = hdr_row.cells[j]
        _shade_cell(cell, "143628")
        p = cell.paragraphs[0]
        p.paragraph_format.space_before = Pt(4)
        p.paragraph_format.space_after = Pt(4)
        r = p.add_run(h)
        r.bold = True
        r.font.size = Pt(8.7)
        r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)

    for i, rdata in enumerate(rows):
        row = tbl.rows[i + 1]
        bg = "FFFFFF" if i % 2 == 0 else "F8FAFC"
        for j, val in enumerate(rdata):
            cell = row.cells[j]
            _shade_cell(cell, bg)
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(3)
            p.paragraph_format.space_after = Pt(3)
            r = p.add_run(str(val))
            r.font.size = Pt(8.5)
            if status_col is not None and j == status_col:
                r.bold = True
                u = str(val).upper()
                if u == "COMPLIANT":
                    r.font.color.rgb = GREEN
                    _shade_cell(cell, "DCFCE7")
                elif u in ("CONDITIONAL", "TRIGGERED"):
                    r.font.color.rgb = AMBER
                    _shade_cell(cell, "FEF3C7")
                elif u == "NON-COMPLIANT":
                    r.font.color.rgb = RED
                    _shade_cell(cell, "FEE2E2")
            else:
                r.font.color.rgb = SLATE


def _add_bullet(doc: Document, text: str, bold_prefix: str | None = None) -> None:
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_before = Pt(1.5)
    p.paragraph_format.space_after = Pt(2)
    if bold_prefix:
        rb = p.add_run(bold_prefix)
        rb.bold = True
        rb.font.size = Pt(9.5)
        rb.font.color.rgb = NAVY
    r = p.add_run(text)
    r.font.size = Pt(9.5)
    r.font.color.rgb = SLATE


def _add_figure(doc: Document, img_path: Path | None, caption: str, width_in: float = 6.5) -> bool:
    if not img_path or not img_path.exists():
        return False
    p_img = doc.add_paragraph()
    p_img.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_img.paragraph_format.space_before = Pt(6)
    p_img.paragraph_format.space_after = Pt(3)
    p_img.paragraph_format.keep_with_next = True
    p_img.add_run().add_picture(str(img_path), width=Inches(width_in))

    p_cap = doc.add_paragraph()
    p_cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_cap.paragraph_format.space_before = Pt(0)
    p_cap.paragraph_format.space_after = Pt(8)
    rc = p_cap.add_run(caption)
    rc.italic = True
    rc.font.size = Pt(8.5)
    rc.font.color.rgb = MUTED
    return True


def _add_page_number_footer(section, footer_left: str) -> None:
    footer = section.footer
    p = footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    r1 = p.add_run(f"{footer_left}   |   Page ")
    r1.font.size = Pt(8)
    r1.font.color.rgb = MUTED
    fld_page = OxmlElement("w:fldSimple")
    fld_page.set(qn("w:instr"), "PAGE")
    p._p.append(fld_page)
    r2 = p.add_run(" of ")
    r2.font.size = Pt(8)
    r2.font.color.rgb = MUTED
    fld_numpages = OxmlElement("w:fldSimple")
    fld_numpages.set(qn("w:instr"), "NUMPAGES")
    p._p.append(fld_numpages)


def build_see_docx_report(
    inp: SEEAssessmentInput,
    spatial: SpatialPreCheckResult,
    audit: SEEComplianceAuditResult,
    out_docx: Path,
    gis_map_png: Path | None = None,
    photo_items: list[tuple[Path, str]] | None = None,
) -> Path:
    """Assemble a complete Lismore City Council Statement of Environmental Effects (.docx)."""
    out_docx.parent.mkdir(parents=True, exist_ok=True)
    doc = Document()
    photo_items = photo_items or []
    cn = inp.custom_narratives

    section = doc.sections[0]
    section.top_margin = Inches(0.68)
    section.bottom_margin = Inches(0.68)
    section.left_margin = Inches(0.75)
    section.right_margin = Inches(0.75)
    _add_page_number_footer(
        section,
        f"SEE — {inp.project_ref} — {inp.site_address} (Lot {inp.lot_number} {inp.plan_label})",
    )

    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(9.8)
    normal.font.color.rgb = SLATE

    zone_str = ", ".join(spatial.land_zoning) if spatial.land_zoning else "Verify Lismore LEP 2012"
    mls_str = ", ".join(spatial.min_lot_size) if spatial.min_lot_size else "Verify LEP MLS"
    dev_type_label = inp.development_type.value.replace("_", " ").title()

    # =========================================================================
    # PAGE 1: COVER SHEET & DA SUMMARY
    # =========================================================================
    p_hdr = doc.add_paragraph()
    p_hdr.paragraph_format.space_after = Pt(2)
    r_co = p_hdr.add_run(f"{inp.consultant.company or inp.consultant.name}\n")
    r_co.bold = True
    r_co.font.size = Pt(13.5)
    r_co.font.color.rgb = NAVY
    bits = [inp.consultant.qualification, f"Lic: {inp.consultant.licence_number}" if inp.consultant.licence_number else None, inp.consultant.email, inp.consultant.postal_address]
    r_sub = p_hdr.add_run("  |  ".join([b for b in bits if b]))
    r_sub.font.size = Pt(8.5)
    r_sub.font.color.rgb = MUTED

    p_title = doc.add_paragraph()
    p_title.paragraph_format.space_before = Pt(14)
    p_title.paragraph_format.space_after = Pt(6)
    rt = p_title.add_run("STATEMENT OF ENVIRONMENTAL EFFECTS (SEE)\n")
    rt.bold = True
    rt.font.size = Pt(19.5)
    rt.font.color.rgb = NAVY
    rs = p_title.add_run(f"{inp.proposal_title}\n")
    rs.bold = True
    rs.font.size = Pt(12)
    rs.font.color.rgb = ACCENT_BLUE
    rs2 = p_title.add_run(
        "Prepared pursuant to Section 4.12 & Section 4.15 of the Environmental Planning and Assessment Act 1979 (NSW) "
        "for Lodgement with Lismore City Council"
    )
    rs2.font.size = Pt(9.3)
    rs2.font.color.rgb = MUTED

    _add_kv_table(
        doc,
        [
            ("Project Reference", inp.project_ref),
            ("Assessment Date", inp.assessment_date.strftime("%d %B %Y")),
            ("Consent Authority", f"{inp.lga} (NSW Planning Portal DA Lodgement)"),
            ("Applicant / Owner", inp.applicant_name),
            ("Site Street Address", inp.site_address),
            ("Real Property Description", f"Lot {inp.lot_number} {inp.plan_label}"),
            ("Allotment Area", f"{inp.block_size_m2:,.0f} m² ({inp.block_size_m2 / 10000:.2f} ha)"),
            ("Land Zoning (Lismore LEP 2012)", f"{zone_str}  |  Minimum Lot Size: {mls_str}"),
            ("Development Category", dev_type_label),
            ("DA Approval Pathway", audit.da_pathway),
            ("Estimated Cost of Works", f"AUD ${inp.estimated_cost_aud:,.0f} (excl. GST — confirm via Cost Summary Report)"),
            ("Proposed Built Form", f"{inp.storeys} storey(s) · {inp.gross_floor_area_m2:.0f} m² GFA · Max Height {inp.building_height_m:.1f} m"),
        ],
    )

    doc.add_paragraph()
    if audit.key_triggers:
        _add_callout(
            doc,
            "Key Statutory Overlays & Specialist Triggers Identified (Live NSW GIS)",
            " | ".join(audit.key_triggers),
            fill_hex="FEF3C7",
            border_hex="B45309",
        )
    else:
        _add_callout(
            doc,
            "Statutory Overlay Pre-Check Summary",
            "No major mapped hazard overlays (Flood, Bushfire, ASS, Drinking Water Catchment, or Biodiversity) triggered on parcel centroid. Standard Lismore LEP 2012 & DCP 2012 controls apply.",
            fill_hex="DCFCE7",
            border_hex="166534",
        )

    p_sig = doc.add_paragraph()
    p_sig.paragraph_format.space_before = Pt(12)
    rsig = p_sig.add_run("Applicant / Owner Endorsement for DA Lodgement:  ")
    rsig.bold = True
    rsig.font.size = Pt(9.2)
    rsig.font.color.rgb = NAVY
    p_sig.add_run("Signature: _____________________________   Date: ____ / ____ / 20____").font.size = Pt(9.2)

    doc.add_page_break()

    # =========================================================================
    # PAGE 2: TABLE OF CONTENTS
    # =========================================================================
    _add_heading(doc, "Table of Contents", level=1)
    _add_grid_table(
        doc,
        ["Section", "Statement of Environmental Effects Contents", "Statutory Reference"],
        [
            ["Section 1", "Executive Summary", "EP&A Act 1979 s4.12 & s4.15"],
            ["Section 2", "Site Context, Property Description & GDA2020 GIS Site Location Map", "NSW Spatial Services / Planning Portal"],
            ["Section 3", "Description of Proposed Development & Operations", "Lismore DA Guide Appendix 1"],
            ["Section 4", "Statutory Assessment — EP&A Act 1979 s4.15 & NSW SEPPs", "Resilience & Hazards, Housing, Primary Production, Biodiversity, BASIX"],
            ["Section 5", "Lismore Local Environmental Plan (LEP) 2012 Assessment", "Zone Objectives & Parts 4, 5 & 6"],
            ["Section 6", "Lismore Development Control Plan (DCP) 2012 Assessment", "Part A Chapters 1, 7, 8, 11, 14 & 22"],
            ["Section 7", "Environmental, Amenity & Natural Hazard Impact Assessment", "EP&A Act s4.15(1)(b)"],
            ["Section 8", "Site Suitability, Public Interest & Environmental Mitigation Schedule", "EP&A Act s4.15(1)(c) & (e)"],
            ["Section 9", "Site Inspection Photographs", "Field Verification"],
            ["Section 10", "Conclusion, NSW Planning Portal DA Checklist & Certification", "Lodgement Verification"],
        ],
    )

    doc.add_page_break()

    # =========================================================================
    # SECTION 1: EXECUTIVE SUMMARY
    # =========================================================================
    _add_heading(doc, "1. Executive Summary", level=1)
    if cn and cn.executive_summary:
        for para in [p.strip() for p in cn.executive_summary.split("\n\n") if p.strip()]:
            doc.add_paragraph(para)
    else:
        doc.add_paragraph(
            f"This Statement of Environmental Effects (SEE) has been prepared by {inp.consultant.company or inp.consultant.name} "
            f"on behalf of {inp.applicant_name} to accompany a Development Application (DA) to {inp.lga} for "
            f"'{inp.proposal_title}' at {inp.site_address} (Lot {inp.lot_number} {inp.plan_label}). "
            f"The site is zoned {zone_str} under the Lismore Local Environmental Plan (LEP) 2012 and comprises "
            f"{inp.block_size_m2:,.0f} m² ({inp.block_size_m2 / 10000:.2f} ha)."
        )
        doc.add_paragraph(
            f"An assessment of the proposal against Section 4.15 of the Environmental Planning and Assessment Act 1979, "
            f"applicable State Environmental Planning Policies (SEPPs), Lismore LEP 2012, and Lismore DCP 2012 confirms "
            f"that the development is compatible with the surrounding rural/local character, satisfies essential service "
            f"requirements (including on-site stormwater and wastewater management), and will not give rise to unreasonable "
            f"environmental, hazard, or neighbour amenity impacts when executed in accordance with the safeguards in Section 8."
        )

    # =========================================================================
    # SECTION 2: SITE CONTEXT & GIS LOCATION MAP
    # =========================================================================
    _add_heading(doc, "2. Site Context, Property Description & GIS Location Map", level=1)
    if cn and cn.site_and_locality_context:
        for para in [p.strip() for p in cn.site_and_locality_context.split("\n\n") if p.strip()]:
            doc.add_paragraph(para)
    else:
        doc.add_paragraph(
            f"The subject property is legally described as Lot {inp.lot_number} {inp.plan_label}, located at "
            f"{inp.site_address} within the {inp.lga} Local Government Area. Existing site character comprises: "
            f"{inp.existing_use_and_structures}."
        )

    _add_kv_table(
        doc,
        [
            ("Cadastre Parcel ID", spatial.lot_id_string),
            ("Parcel Centroid (GDA2020 MGA56)", f"E {spatial.centroid_easting_mga56:.1f}, N {spatial.centroid_northing_mga56:.1f} (Lat {spatial.centroid_lat}, Lon {spatial.centroid_lon})" if spatial.centroid_easting_mga56 else "Verify on site"),
            ("Land Zoning & Minimum Lot Size", f"{zone_str}  |  MLS: {mls_str}"),
            ("Flood Planning / Landslide", f"Flood Planning: {'YES' if spatial.flood_planning else 'No'}  |  Landslide Risk: {'YES' if spatial.landslide_risk else 'No'}"),
            ("Bushfire Prone Land (BFPL)", ", ".join(spatial.bushfire_prone_land) if spatial.bushfire_prone_land else "None mapped"),
            ("Acid Sulfate Soils (ASS)", ", ".join(spatial.acid_sulfate_soils) if spatial.acid_sulfate_soils else "None mapped"),
            ("Drinking Water Catchment (Cl. 6.4)", "YES — Rous Water Guidelines Apply" if spatial.drinking_water_catchment else "No"),
            ("Biodiversity / Riparian / Wetlands", f"Biodiversity: {'Yes' if spatial.terrestrial_biodiversity else 'No'} | Riparian: {'Yes' if spatial.riparian_land else 'No'} | Wetlands: {'Yes' if spatial.wetlands else 'No'}"),
            ("Nearest Mapped Watercourse", f"{spatial.nearest_watercourse_m:.1f} m from parcel edge" if spatial.nearest_watercourse_m is not None else "None within 300 m"),
        ],
    )

    _add_figure(
        doc,
        gis_map_png,
        "Figure 1: GDA2020 / MGA Zone 56 Site Location, Cadastre, Contours & Watercourse Buffer Map (Drawing SEE-GIS-01).",
        width_in=6.5,
    )

    doc.add_page_break()

    # =========================================================================
    # SECTION 3: DESCRIPTION OF PROPOSED DEVELOPMENT
    # =========================================================================
    _add_heading(doc, "3. Description of Proposed Development", level=1)
    if cn and cn.proposal_details_narrative:
        for para in [p.strip() for p in cn.proposal_details_narrative.split("\n\n") if p.strip()]:
            doc.add_paragraph(para)
        if cn.source_documents_summary:
            _add_callout(doc, "Supporting Plans & Documents Reviewed", cn.source_documents_summary, fill_hex="F8FAFC", border_hex="475569")
    else:
        doc.add_paragraph(
            inp.proposal_summary
            or f"Development consent is sought for {inp.proposal_title} ({dev_type_label}) comprising {inp.storeys} storey(s) "
               f"with a Gross Floor Area of {inp.gross_floor_area_m2:.0f} m² and maximum building height of {inp.building_height_m:.1f} m."
        )

    prop_rows = [
        ("Development Type & Scope", f"{dev_type_label} — {inp.proposal_title}"),
        ("Gross Floor Area / Height / Storeys", f"{inp.gross_floor_area_m2:.0f} m² GFA  |  Max Height {inp.building_height_m:.1f} m  |  {inp.storeys} storey(s)"),
        ("External Materials & Finishes", inp.materials_and_colours),
        ("Earthworks (Cut / Fill / Footprint)", f"Max Cut: {inp.cut_max_m:.2f} m  |  Max Fill: {inp.fill_max_m:.2f} m  |  Disturbed Area: {inp.disturbed_area_m2:.0f} m²"),
        ("Vegetation & Tree Management", f"Native trees proposed for removal: {inp.native_trees_removed}. {inp.vegetation_notes}"),
        ("Vehicular Access & Parking", f"{inp.existing_access}. On-site parking: {inp.proposed_parking_spaces} space(s) (~{inp.vehicle_movements_per_day} veh/day)."),
        ("Water Supply & Firefighting Reserve", inp.water_supply_method),
        ("Electricity & Telecommunications", inp.electricity_and_comms),
        ("Stormwater Management (WSD)", inp.stormwater_management),
        ("On-Site Sewage Management (s68)", inp.linked_ossm_summary or inp.wastewater_management_summary),
    ]
    if inp.operating_hours:
        prop_rows.append(("Proposed Operating Hours", inp.operating_hours))
    if inp.staff_or_guests_max:
        prop_rows.append(("Maximum Staff / Guests / Capacity", inp.staff_or_guests_max))
    _add_kv_table(doc, prop_rows)

    # =========================================================================
    # SECTION 4: STATUTORY ASSESSMENT (EP&A ACT s4.15 & SEPPs)
    # =========================================================================
    _add_heading(doc, "4. Statutory Planning Assessment (EP&A Act 1979 s4.15 & NSW SEPPs)", level=1)
    doc.add_paragraph(
        "Section 4.15(1) of the Environmental Planning and Assessment Act 1979 requires Lismore City Council to evaluate "
        "relevant environmental planning instruments (SEPPs & Lismore LEP 2012), development control plans (Lismore DCP 2012), "
        "likely natural/built/social/economic impacts, site suitability, and the public interest."
    )
    sepp_checks = [c for c in audit.checks if c.instrument in ("SEPP", "RFS / Other", "EP&A Act 1979")]
    _add_grid_table(
        doc,
        ["Code", "Instrument / Clause", "Planning Topic", "Site Status", "Status", "Compliance Assessment"],
        [[c.code, c.clause, c.topic, c.site_status, c.compliance, c.assessment_note] for c in sepp_checks],
        status_col=4,
    )

    # =========================================================================
    # SECTION 5: LISMORE LEP 2012 ASSESSMENT
    # =========================================================================
    _add_heading(doc, "5. Lismore Local Environmental Plan (LEP) 2012 Assessment", level=1)
    if cn and cn.statutory_zone_justification:
        for para in [p.strip() for p in cn.statutory_zone_justification.split("\n\n") if p.strip()]:
            doc.add_paragraph(para)
    else:
        doc.add_paragraph(
            f"Zoning & Permissibility ({zone_str}): {audit.permissibility_note}"
        )
    lep_checks = [c for c in audit.checks if c.instrument == "Lismore LEP 2012"]
    _add_grid_table(
        doc,
        ["Code", "LEP Clause", "Control", "Site Value", "Status", "Assessment"],
        [[c.code, c.clause, c.topic, c.site_status, c.compliance, c.assessment_note] for c in lep_checks],
        status_col=4,
    )

    # =========================================================================
    # SECTION 6: LISMORE DCP 2012 (PART A) COMPLIANCE MATRIX
    # =========================================================================
    _add_heading(doc, "6. Lismore Development Control Plan (DCP) 2012 — Part A Assessment", level=1)
    dcp_checks = [c for c in audit.checks if c.instrument == "Lismore DCP 2012"]
    _add_grid_table(
        doc,
        ["Code", "DCP Chapter", "Control Topic", "Site Value", "Status", "Compliance Response"],
        [[c.code, c.clause, c.topic, c.site_status, c.compliance, c.assessment_note] for c in dcp_checks],
        status_col=4,
    )

    doc.add_page_break()

    # =========================================================================
    # SECTION 7: ENVIRONMENTAL, AMENITY & NATURAL HAZARD IMPACTS (s4.15(1)(b))
    # =========================================================================
    _add_heading(doc, "7. Environmental, Amenity & Natural Hazard Impact Assessment (s4.15(1)(b))", level=1)
    if cn and cn.environmental_impacts_and_mitigation:
        for para in [p.strip() for p in cn.environmental_impacts_and_mitigation.split("\n\n") if p.strip()]:
            doc.add_paragraph(para)
    else:
        _add_bullet(doc, f"{'Site is mapped Bushfire Prone Land (' + ', '.join(spatial.bushfire_prone_land) + '); compliance with Planning for Bush Fire Protection 2019 (BAL rating, APZ, 20,000 L static water supply & compliant access) will be demonstrated.' if spatial.bushfire_prone_land else 'Site is not mapped as Bushfire Prone Land on NSW Planning Portal overlays.'}", "Bushfire Risk: ")
        _add_bullet(doc, f"{'Site intersects mapped Flood Planning Area; design incorporates habitable floor freeboard, flood-compatible construction materials, and safe evacuation in accordance with Lismore LEP Cl. 5.21 and DCP Part A Ch. 8.' if spatial.flood_planning else 'Site sits outside mapped Flood Planning Areas; overland stormwater is diverted cleanly around structures.'}", "Flooding & Overland Flow: ")
        _add_bullet(doc, f"{inp.vegetation_notes} (Native trees removed: {inp.native_trees_removed}).", "Ecology, Vegetation & Koala Habitat: ")
        _add_bullet(doc, f"{inp.stormwater_management}", "Stormwater & Water Sensitive Design: ")
        _add_bullet(doc, f"{inp.linked_ossm_summary or inp.wastewater_management_summary}", "On-Site Sewage Management (s68): ")
        _add_bullet(doc, f"{inp.construction_waste_and_escp}", "Earthworks, Erosion, Sediment & Waste Control: ")
        _add_bullet(doc, f"{inp.neighbour_amenity_notes}", "Visual Bulk, Overshadowing, Noise & Neighbour Privacy: ")
        _add_bullet(doc, f"{inp.existing_access} ({inp.proposed_parking_spaces} spaces; ~{inp.vehicle_movements_per_day} movements/day).", "Traffic, Parking & Access: ")

    # =========================================================================
    # SECTION 8: SITE SUITABILITY, PUBLIC INTEREST & MITIGATION SCHEDULE
    # =========================================================================
    _add_heading(doc, "8. Site Suitability (s4.15(1)(c)), Public Interest (s4.15(1)(e)) & Mitigation Schedule", level=1)
    if cn and cn.site_suitability_and_public_interest:
        for para in [p.strip() for p in cn.site_suitability_and_public_interest.split("\n\n") if p.strip()]:
            doc.add_paragraph(para)
    else:
        doc.add_paragraph(
            f"Site Suitability: The allotment ({inp.block_size_m2 / 10000:.2f} ha, Zone {zone_str}) has legal vehicular access, "
            f"adequate cleared building envelope, essential servicing capability, and sufficient area for sustainable "
            f"stormwater and on-site wastewater management. The site is demonstrably suitable for the proposed {dev_type_label.lower()}."
        )
        doc.add_paragraph(
            "Public Interest: The proposal aligns with Lismore LEP 2012 zone objectives, supports sustainable Northern Rivers "
            "housing/rural enterprise without environmental degradation or adverse neighbour impact, and is therefore in the public interest."
        )

    _add_heading(doc, "8.1 Environmental Safeguards & Mitigation Schedule", level=2)
    mit_rows = [
        ["Erosion & Sediment Control", "Pre-construction & Construction", inp.construction_waste_and_escp],
        ["Construction Hours & Noise", "Construction", "Restrict noisy works to NSW EPA standard hours (Mon–Fri 7am–6pm, Sat 8am–1pm; no Sunday/public holiday works)."],
        ["Stormwater Dispersion", "Post-construction / Ongoing", inp.stormwater_management],
        ["On-Site Wastewater (s68)", "Prior to Occupation / Ongoing", inp.linked_ossm_summary or inp.wastewater_management_summary],
        ["Aboriginal & Cultural Heritage", "All Earthworks", "Implement unexpected finds protocol; cease works immediately and notify Heritage NSW & Local Aboriginal Land Council if relics encountered."],
    ]
    if spatial.bushfire_prone_land:
        mit_rows.append(["Bushfire Protection (PBP 2019)", "Design & Ongoing", "Maintain Asset Protection Zones (APZs), ember-resistant BAL construction, and dedicated 20,000 L static firefighting water supply."])
    if spatial.flood_planning:
        mit_rows.append(["Flood Resilience (Cl. 5.21)", "Design & Construction", "Construct habitable floors above Flood Planning Level using flood-compatible materials below FPL; maintain flood emergency plan."])
    _add_grid_table(doc, ["Environmental Aspect", "Timing / Stage", "Committed Safeguard / Mitigation Control"], mit_rows)

    doc.add_page_break()

    # =========================================================================
    # SECTION 9: SITE INSPECTION PHOTOGRAPHS
    # =========================================================================
    _add_heading(doc, "9. Site Inspection Photographs", level=1)
    valid_photos = [(p, cap) for (p, cap) in photo_items if p and p.exists()]
    if valid_photos:
        for idx, (ppath, caption) in enumerate(valid_photos, start=1):
            _add_figure(doc, ppath, f"Photo {idx}: {caption}", width_in=5.6)
    else:
        doc.add_paragraph(
            "Attach geotagged site photographs in Tab 2 of the Field To Forest Workbench to embed them automatically into this SEE."
        )

    # =========================================================================
    # SECTION 10: CONCLUSION, DA LODGEMENT CHECKLIST & CERTIFICATION
    # =========================================================================
    _add_heading(doc, "10. Conclusion, NSW Planning Portal DA Checklist & Certification", level=1)
    doc.add_paragraph(
        f"Having regard to Section 4.15 of the Environmental Planning and Assessment Act 1979, Lismore LEP 2012, "
        f"and Lismore DCP 2012, the proposed {inp.proposal_title} at {inp.site_address} (Lot {inp.lot_number} {inp.plan_label}) "
        f"is permissible, environmentally sustainable, and warrants favourable determination by {inp.lga} subject to standard conditions of consent."
    )

    _add_heading(doc, "10.1 Recommended NSW Planning Portal DA Lodgement Attachments", level=2)
    attach_rows = [
        ["Statement of Environmental Effects (this report)", "Mandatory (EP&A Regs)", "Attached"],
        ["Architectural Site Plan, Floor Plans, Elevations & Sections (1:100 / 1:200)", "Mandatory", "Attach with DA"],
        ["Owner's Consent Form & Estimated Development Cost Summary", "Mandatory", "Attach with DA"],
    ]
    for rep in audit.required_specialist_reports:
        attach_rows.append([rep, "Triggered by Site / Proposal", "Required with DA"])
    _add_grid_table(doc, ["Document / Specialist Report", "Trigger Basis", "Status"], attach_rows)

    p_cert = doc.add_paragraph()
    p_cert.paragraph_format.space_before = Pt(12)
    rc = p_cert.add_run(
        f"Prepared By: {inp.consultant.name} ({inp.consultant.qualification}"
        + (f", Lic. {inp.consultant.licence_number}" if inp.consultant.licence_number else "")
        + f")   |   Date: {inp.assessment_date.strftime('%d %B %Y')}"
    )
    rc.bold = True
    rc.font.color.rgb = NAVY

    doc.save(str(out_docx))
    return out_docx
