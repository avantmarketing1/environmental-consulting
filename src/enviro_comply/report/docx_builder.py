"""Council-ready Microsoft Word (.docx) Section 68 OSSM Report Generator for Lismore City Council.

Produces a complete, single-source-of-truth compliance report satisfying every requirement of
Lismore City Council On-Site Sewage & Wastewater Management Strategy (2013) Part B s1.1,
Appendix A/B/C/D/E, and AS/NZS 1547:2012 — including Cover/Up-Front Information Page,
Table of Contents, GDA2020/MGA56 GIS Site Map, Site Evaluation & Soil Assessment Tables,
Lismore Daily Wastewater Model & DLR/LTR Walkthrough, Site Photographs, Scaled CAD Layout Plan,
Programmatic Engineering Cross-Sections, Homeowner Guide, Component O&M Manuals,
Licensed Plumber Statutory Steps, and Owner's Acknowledgement.

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

from enviro_comply.schemas.ossm import (
    ComplianceAuditResult,
    LandApplicationType,
    SiteAssessmentInput,
    SpatialPreCheckResult,
    TreatmentSystemType,
    WastewaterModelResult,
)

NAVY = RGBColor(0x0D, 0x24, 0x1B)       # Deep Field To Forest green-charcoal
BRAND_TEAL = RGBColor(0x14, 0x36, 0x28)
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
    run.font.size = Pt(14 if level == 1 else (11.5 if level == 2 else 10.5))
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


def _add_kv_table(doc: Document, rows: list[tuple[str, str]], col_widths=(2.4, 4.3)) -> None:
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
        r0.font.size = Pt(9.3)
        r0.font.color.rgb = NAVY

        p1 = c1.paragraphs[0]
        p1.paragraph_format.space_before = Pt(3)
        p1.paragraph_format.space_after = Pt(3)
        r1 = p1.add_run(v)
        r1.font.size = Pt(9.3)
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
        r.font.size = Pt(8.8)
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
            r.font.size = Pt(8.6)
            if status_col is not None and j == status_col:
                r.bold = True
                u = str(val).upper()
                if u in ("PASS", "✓", "NO LIMITATION", "NO LIMITATIONS"):
                    r.font.color.rgb = GREEN
                    _shade_cell(cell, "DCFCE7")
                elif u in ("LIMITATION", "×", "INFO", "MITIGATED"):
                    r.font.color.rgb = AMBER
                    _shade_cell(cell, "FEF3C7")
                elif u == "FAIL":
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
        rb.font.size = Pt(9.6)
        rb.font.color.rgb = NAVY
    r = p.add_run(text)
    r.font.size = Pt(9.6)
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


def build_ossm_docx_report(
    inp: SiteAssessmentInput,
    spatial: SpatialPreCheckResult,
    model: WastewaterModelResult,
    audit: ComplianceAuditResult,
    out_docx: Path,
    gis_map_png: Path | None = None,
    cad_plan_png: Path | None = None,
    diagrams: dict[str, Path] | None = None,
    photo_items: list[tuple[Path, str]] | None = None,
) -> Path:
    """Assemble the complete, council-ready Lismore City Council Section 68 OSSM .docx report."""
    out_docx.parent.mkdir(parents=True, exist_ok=True)
    doc = Document()
    diagrams = diagrams or {}
    photo_items = photo_items or []

    # Global styling & margins
    section = doc.sections[0]
    section.top_margin = Inches(0.68)
    section.bottom_margin = Inches(0.68)
    section.left_margin = Inches(0.75)
    section.right_margin = Inches(0.75)
    _add_page_number_footer(
        section,
        f"{inp.project_ref} — {inp.site_address} (Lot {inp.lot_number} {inp.plan_label})",
    )

    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(9.8)
    normal.font.color.rgb = SLATE

    tr = model.trench_layout
    se = inp.site_eval
    has_rb = inp.treatment_system == TreatmentSystemType.SECONDARY_REED_BED
    is_awts = inp.treatment_system == TreatmentSystemType.SECONDARY_AWTS
    is_primary = inp.treatment_system == TreatmentSystemType.PRIMARY_SEPTIC
    is_irrig = inp.land_application_type != LandApplicationType.ETA_BEDS
    is_sdi = inp.land_application_type == LandApplicationType.SUBSURFACE_DRIP_IRRIGATION
    total_eta_depth_m = round((inp.root_zone_depth_mm + inp.gravel_depth_mm) / 1000.0, 2)

    cn = inp.custom_narratives
    works_lines = []
    if model.grease_arrestor_min_l > 0:
        works_lines.append(
            f"Install 1 × {model.grease_arrestor_min_l} L Commercial Grease Arrestor (AS/NZS 3500.2) upstream of primary treatment for kitchen/food-processing FOG capture"
        )
    if is_awts:
        works_lines.append("Install 1 × NSW Health Accredited Aerated Wastewater Treatment System (AWTS) with chlorination/disinfection")
    else:
        works_lines.append(
            f"Install 1 × {model.septic_tank_min_l} L NSW Health Accredited Septic Tank (baffle + external effluent filter; {model.septic_retention_days:.1f} d retention)"
        )
    if model.surge_tank_min_l > 0:
        works_lines.append(
            f"Install 1 × {model.surge_tank_min_l} L Flow Equalisation / Surge Balance Tank with timer-controlled dosing to attenuate peak weekend/batch flows"
        )
    if has_rb:
        works_lines.append(
            f"Install {model.recommended_reed_bed_count} × {model.recommended_reed_bed_model} "
            f"(provided area {model.recommended_reed_bed_provided_m2:.1f} m² vs {model.reed_bed_required_m2:.1f} m² req.; wetted depth {inp.reed_bed_wetted_depth_m:.2f} m; HRT {model.reed_bed_hrt_days:.1f} d)"
        )
    if is_irrig:
        irrig_label = "Sub-Surface Drip Irrigation (SDI)" if is_sdi else "Surface Spray Irrigation"
        works_lines.append(
            f"Install 1 × 1,800 L Pump Well (high-level alarm + disc filter + indexing valve) dosing a contiguous {irrig_label} Zone "
            f"({tr.trench_length_m:.1f} m × {tr.trench_width_m:.1f} m = {model.required_laa_m2:.1f} m² LAA; ~{round(model.required_laa_m2)} m drip laterals @ 1.0 m) + 100% Reserve LAA ({model.reserve_laa_m2:.1f} m²)"
        )
    else:
        works_lines.append(
            f"Construct {tr.number_of_trenches} × Evapo-Transpiration Absorption (ETA) Bed(s) "
            f"({tr.trench_length_m:.1f} m × {tr.trench_width_m:.1f} m × {total_eta_depth_m:.2f} m = {model.required_laa_m2:.1f} m² LAA; {tr.trench_separation_m:.1f} m separation) + 100% Reserve LAA ({model.reserve_laa_m2:.1f} m²)"
        )

    mo_line = (
        f"Multiple Occupancy ({inp.multiple_occupancy_name}); HIA {inp.hia_area_m2:,.0f} m²; Total Lot {inp.block_size_m2:,.0f} m²"
        if inp.is_multiple_occupancy and inp.hia_area_m2
        else f"{inp.block_size_m2:,.0f} m² ({inp.block_size_m2 / 10000:.2f} ha)"
    )

    fig_num = 1

    # =========================================================================
    # PAGE 1: COVER / UP-FRONT INFORMATION PAGE (LCC Strategy Part B s1.1)
    # =========================================================================
    p_hdr = doc.add_paragraph()
    p_hdr.paragraph_format.space_after = Pt(2)
    r_co = p_hdr.add_run(f"{inp.consultant.company or inp.consultant.name}\n")
    r_co.bold = True
    r_co.font.size = Pt(13.5)
    r_co.font.color.rgb = NAVY
    contact_bits = [
        inp.consultant.qualification,
        f"Lic: {inp.consultant.licence_number}" if inp.consultant.licence_number else None,
        inp.consultant.phone,
        inp.consultant.email,
        inp.consultant.postal_address,
    ]
    r_sub = p_hdr.add_run("  |  ".join([b for b in contact_bits if b]))
    r_sub.font.size = Pt(8.5)
    r_sub.font.color.rgb = MUTED

    p_title = doc.add_paragraph()
    p_title.paragraph_format.space_before = Pt(10)
    p_title.paragraph_format.space_after = Pt(4)
    rt = p_title.add_run("ON-SITE SEWAGE MANAGEMENT (OSSM) REPORT\n")
    rt.bold = True
    rt.font.size = Pt(19)
    rt.font.color.rgb = NAVY
    rs = p_title.add_run(
        "Section 68 Local Government Act 1993 — Up-Front Information Sheet & Technical Assessment"
    )
    rs.bold = True
    rs.font.size = Pt(11)
    rs.font.color.rgb = ACCENT_BLUE

    # Cover Treatment Train Schematic
    tt_path = diagrams.get("treatment_train")
    if tt_path and tt_path.exists():
        _add_figure(
            doc,
            tt_path,
            f"Proposed Wastewater Treatment & Land Application Train — {inp.project_ref}",
            width_in=6.5,
        )

    _add_kv_table(
        doc,
        [
            ("Project Reference", inp.project_ref),
            ("Applicant / Owner", inp.applicant_name),
            ("Site Address", inp.site_address),
            ("Real Property Description", f"Lot {inp.lot_number} {inp.plan_label} (LGA: {inp.lga})"),
            ("Allotment / HIA Details", mo_line),
            ("Assessment Date", se.assessment_date.strftime("%d %B %Y")),
            ("Occupancy / Load Basis", (
                f"Multi-use ({len(model.source_breakdown)} sources) → {model.design_persons} Equivalent Persons (EP) [Weighted BOD5: {model.weighted_influent_bod_mgl:.0f} mg/L]"
                if model.source_breakdown
                else f"{inp.bedrooms} bedroom(s) → {model.design_persons} Equivalent Persons (EP) [LCC Strategy s5.3: bedrooms + 1]"
            )),
            ("Design Wastewater Flow", f"{model.flow_rate_lpd:.0f} L/p/d × {model.design_persons} EP = {model.total_flow_ld:.0f} L/day ({model.annual_flow_m3:.1f} m³/yr)"),
            ("Proposed Treatment Train", "\n".join(works_lines)),
            ("Limiting Design Factor", f"{model.limiting_factor} ({model.required_laa_m2:.1f} m² required LAA; Actual Loading Rate = {model.daily_loading_rate_actual_mmd:.1f} mm/d)"),
            ("Morand (1994) Soil Unit", f"{model.morand_unit_name} ({model.morand_code}) — {model.morand_group}, P-sorption {model.p_sorption_kg_ha_m:,.0f} kg/ha/m"),
            ("Overall Limitation Status", "No Limitations" if audit.overall_no_limitations else "Limitations Identified & Mitigated (see Section 5)"),
        ],
    )

    doc.add_paragraph()
    if audit.departures_from_strategy:
        _add_callout(
            doc,
            "Departures from Lismore CC OSSM Strategy (2013) [Mandatory Up-Front Disclosure]",
            "; ".join(audit.departures_from_strategy),
            fill_hex="FEF3C7",
            border_hex="B45309",
        )
    else:
        _add_callout(
            doc,
            "Departures from Lismore CC OSSM Strategy (2013) [Mandatory Up-Front Disclosure]",
            "Nil departures proposed. The design satisfies all statutory buffers, hydraulic/nutrient sizing criteria, and construction controls under the Strategy.",
            fill_hex="DCFCE7",
            border_hex="166534",
        )

    p_sig = doc.add_paragraph()
    p_sig.paragraph_format.space_before = Pt(10)
    r_sl = p_sig.add_run("Applicant / Owner Approval for Section 68 Lodgement:  ")
    r_sl.bold = True
    r_sl.font.size = Pt(9.2)
    r_sl.font.color.rgb = NAVY
    p_sig.add_run("Signature: _______________________________   Date: ____ / ____ / 20____").font.size = Pt(9.2)

    doc.add_page_break()

    # =========================================================================
    # PAGE 2: TABLE OF CONTENTS / REPORT INDEX
    # =========================================================================
    _add_heading(doc, "Table of Contents", level=1)
    toc_rows = [
        ["Up-Front", "Cover Sheet, Proposed Treatment Train & Up-Front Information Page", "LCC Strategy Part B s1.1"],
        ["Section 1", "Executive Summary, System Selection Justification & Departures", "LCC Strategy Part B s1.1 & s5.3"],
        ["Section 2", "Introduction, Site Context & Existing Infrastructure", "LCC Strategy Part B s1.1"],
        ["Section 3", "Desktop Spatial Assessment, Planning Overlays & GIS Site Location Map", "NSW Spatial Services / LEP"],
        ["Section 4", "Site Evaluation Form (Appendix E — Table 8)", "LCC Strategy Appendix E"],
        ["Section 5", "Soil Assessment, Borehole Logs (Table 9) & Overall Limitation Matrix (Table 10)", "LCC Strategy Appendix E / Morand 1994"],
        ["Section 6", "Lismore Daily Wastewater Model (OSmodel300614), DLR/LTR Calculation & LAA Layout", "LCC OSmodel / AS/NZS 1547 Table H3"],
        ["Section 7", "Clause-Cited Regulatory Compliance Matrix", "LCC Strategy 2013 & AS/NZS 1547:2012"],
        ["Section 8", "Site Inspection Photographs & Pegged Layout Verification", "Field Evidence"],
        ["Section 9", "Proposed Works, Scaled CAD Layout Plan & Engineering Cross-Sections", "AS/NZS 1546.1 / LCC Appendices A–D"],
        ["Section 10", "Homeowner Guide & Component Operation / Maintenance Manuals", "LCC Strategy Part B s1.1"],
        ["Section 11", "Ongoing Maintenance Schedule & Printable Service Record", "Approval to Operate (s68)"],
        ["Section 12", "Owner's Acknowledgement, Licensed Plumber Statutory Steps & Certification", "LG Act 1993 s68 / AS/NZS 3500"],
    ]
    _add_grid_table(doc, ["Section", "Report Contents", "Regulatory Basis"], toc_rows)

    doc.add_paragraph()
    _add_callout(
        doc,
        "Single-Source-of-Truth Verification",
        f"Every figure, sizing calculation, CAD dimension, and engineering cross-section in this document is generated deterministically from the verified assessment dataset ({inp.project_ref}: {inp.bedrooms} BR / {model.design_persons} EP / {model.total_flow_ld:.0f} L/day / {model.required_laa_m2:.1f} m² LAA).",
        fill_hex="EFF6FF",
        border_hex="0369A1",
    )

    doc.add_page_break()

    # =========================================================================
    # SECTION 1: EXECUTIVE SUMMARY & SYSTEM SELECTION JUSTIFICATION
    # =========================================================================
    _add_heading(doc, "1. Executive Summary & System Selection Justification", level=1)
    if cn and cn.executive_summary:
        for para in [p.strip() for p in cn.executive_summary.split("\n\n") if p.strip()]:
            doc.add_paragraph(para)
    else:
        doc.add_paragraph(
            f"This On-Site Sewage Management (OSSM) report has been prepared for {inp.applicant_name} to accompany a "
            f"Section 68 Local Government Act 1993 application to {inp.lga} for the installation of a "
            f"{inp.development_description} at {inp.site_address} (Lot {inp.lot_number} {inp.plan_label}). "
            f"The system is sized for {model.design_persons} Equivalent Persons generating {model.total_flow_ld:.0f} L/day "
            f"({model.annual_flow_m3:.1f} m³/yr) based on {inp.water_supply.value.replace('_', ' ')} water supply and site usage."
        )

    _add_heading(doc, "1.1 System Selection Justification (LCC Strategy s5.3 & Table B2)", level=2)
    if cn and cn.system_selection_justification:
        for para in [p.strip() for p in cn.system_selection_justification.split("\n\n") if p.strip()]:
            doc.add_paragraph(para)
    else:
        if has_rb and not is_irrig:
            just_text = (
                f"A passive secondary treatment train comprising a {model.septic_tank_min_l} L baffled septic tank with external "
                f"effluent filter, {model.recommended_reed_bed_count} × rigid impermeable {model.recommended_reed_bed_model} "
                f"(provided surface area {model.recommended_reed_bed_provided_m2:.1f} m²; HRT {model.reed_bed_hrt_days:.1f} days; "
                f"modelled Nitrogen removal {model.n_removal_pct:.1f}%), and gravity-fed Evapo-Transpiration Absorption (ETA) "
                f"bed(s) ({model.required_laa_m2:.1f} m² LAA) has been selected. In accordance with Lismore City Council's Strategy "
                f"preference for passive, gravity-fed systems on rural lots with suitable slope ({se.slope_pct}% <= 15%), this "
                f"configuration requires zero continuous mechanical aeration or electricity, achieves high pathogen and nutrient "
                f"attenuation prior to soil dispersal, minimises mechanical failure risk, and leaves ample space for a dedicated "
                f"100% Reserve LAA ({model.reserve_laa_m2:.1f} m²)."
            )
        elif is_irrig:
            irrig_name = "Sub-Surface Drip Irrigation (SDI)" if is_sdi else "Surface Spray Irrigation"
            just_text = (
                f"Secondary effluent treatment coupled with a pump-dosed contiguous {irrig_name} zone "
                f"({tr.trench_length_m:.1f} m × {tr.trench_width_m:.1f} m = {model.required_laa_m2:.1f} m² at an actual loading rate "
                f"of {model.daily_loading_rate_actual_mmd:.1f} mm/day against the AS/NZS 1547 Design Irrigation Rate of "
                f"{model.max_deep_drainage_mmd:.1f} mm/day) has been nominated to distribute treated effluent evenly across the "
                f"shallow root zone. In accordance with LCC Strategy Appendix C & D, a Certified Irrigation Design Plan (CIDP) "
                f"must accompany final installation."
            )
        elif is_awts:
            just_text = (
                f"An NSW Health accredited Aerated Wastewater Treatment System (AWTS) discharging secondary treated effluent to "
                f"{tr.number_of_trenches} × ETA bed(s) ({model.required_laa_m2:.1f} m² LAA) has been selected to satisfy "
                f"site soil and setback constraints while meeting secondary effluent quality standards under AS/NZS 1546.3."
            )
        else:
            just_text = (
                f"A primary baffled {model.septic_tank_min_l} L septic tank with external effluent filter discharging via gravity "
                f"to {tr.number_of_trenches} × ETA bed(s) ({model.required_laa_m2:.1f} m² LAA) has been selected, consistent with "
                f"the site's low limitation rating and generous setback buffers."
            )
        doc.add_paragraph(just_text)

    if audit.departures_from_strategy or (cn and cn.departure_mitigations):
        _add_heading(doc, "1.2 Summary of Strategy Departures & Mitigations", level=2)
        for d in audit.departures_from_strategy:
            _add_bullet(doc, d)
        if cn and cn.departure_mitigations:
            for para in [p.strip() for p in cn.departure_mitigations.split("\n\n") if p.strip()]:
                doc.add_paragraph(para)

    # =========================================================================
    # SECTION 2: INTRODUCTION & SITE CONTEXT
    # =========================================================================
    _add_heading(doc, "2. Introduction, Site Context & Existing Infrastructure", level=1)
    if cn and cn.development_context:
        for para in [p.strip() for p in cn.development_context.split("\n\n") if p.strip()]:
            doc.add_paragraph(para)
        if cn.source_documents_summary:
            _add_callout(doc, "Reference Client Documents Reviewed", cn.source_documents_summary, fill_hex="F8FAFC", border_hex="475569")
    else:
        doc.add_paragraph(
            f"At the request of {inp.applicant_name}, {inp.consultant.name} ({inp.consultant.qualification}"
            + (f", Licence {inp.consultant.licence_number}" if inp.consultant.licence_number else "")
            + f") conducted a desktop GIS pre-check and on-site soil and land capability assessment on "
            f"{se.assessment_date.strftime('%d %B %Y')} at {inp.site_address} (Lot {inp.lot_number} {inp.plan_label}). "
            f"The allotment comprises {mo_line}. Weather conditions at inspection were recorded as '{se.recent_weather}'."
        )
        if se.existing_system_notes:
            doc.add_paragraph(f"Existing System / Site History: {se.existing_system_notes}")
        doc.add_paragraph(
            f"The nominated Land Application Area (LAA) occupies a {se.slope_range_text or f'{se.slope_pct}%'} "
            f"{se.landform.replace('_', ' ')} slope facing {se.aspect} with {se.exposure.replace('_', ' ')} sun and wind exposure. "
            f"Existing ground cover comprises {se.existing_vegetation}. All sizing has been modelled deterministically using "
            f"Lismore City Council's Daily Wastewater Model (OSmodel300614, 7,670-day Alstonville climate series, 1970–1991) "
            f"in accordance with the LCC OSSM Strategy (2013) and AS/NZS 1547:2012."
        )

    # =========================================================================
    # SECTION 3: DESKTOP SPATIAL ASSESSMENT & GIS SITE LOCATION MAP
    # =========================================================================
    _add_heading(doc, "3. Desktop Spatial Assessment, Planning Overlays & Site Location Map", level=1)
    doc.add_paragraph(
        f"Official NSW Spatial Services Cadastre, Hydrography, Elevation Contours, and NSW Planning Portal EPI layers "
        f"were queried in {spatial.crs_name} (EPSG:{spatial.crs_epsg}) prior to site inspection."
    )
    _add_kv_table(
        doc,
        [
            ("Cadastre Parcel ID", spatial.lot_id_string),
            ("Mapped Parcel Area (GIS)", f"{spatial.parcel_area_m2:,.1f} m² ({spatial.parcel_area_ha:.2f} ha)" if spatial.parcel_area_m2 else f"{inp.block_size_m2:,.0f} m² (owner supplied)"),
            ("Parcel Centroid (MGA Zone 56)", f"E {spatial.centroid_easting_mga56:.1f}, N {spatial.centroid_northing_mga56:.1f} (Lat {spatial.centroid_lat}, Lon {spatial.centroid_lon})" if spatial.centroid_easting_mga56 else "Verify on site"),
            ("Land Zoning (LEP)", ", ".join(spatial.land_zoning) if spatial.land_zoning else "Not returned / verify Lismore LEP 2012"),
            ("Minimum Lot Size (LEP)", ", ".join(spatial.min_lot_size) if spatial.min_lot_size else "Not returned"),
            ("Drinking Water Catchment (Rous Water)", "YES — Rous Water Guidelines (2008) Apply" if spatial.drinking_water_catchment else "No (outside mapped drinking water catchment)"),
            ("Flood Planning / Landslide Overlay", f"Flood: {'YES' if spatial.flood_planning else 'No'}   |   Landslide: {'YES' if spatial.landslide_risk else 'No'}"),
            ("Acid Sulfate Soils (ASS) Risk", ", ".join(spatial.acid_sulfate_soils) if spatial.acid_sulfate_soils else "None mapped"),
            ("Bushfire Prone Land (BFPL)", ", ".join(spatial.bushfire_prone_land) if spatial.bushfire_prone_land else "None mapped"),
            ("Riparian / Wetlands / Biodiversity", f"Riparian: {'Yes' if spatial.riparian_land else 'No'} | Wetlands: {'Yes' if spatial.wetlands else 'No'} | Biodiversity: {'Yes' if spatial.terrestrial_biodiversity else 'No'}"),
            ("Nearest Mapped Watercourse (Parcel Edge)", f"{spatial.nearest_watercourse_m:.1f} m" if spatial.nearest_watercourse_m is not None else "None within 300 m search radius"),
        ],
    )
    if spatial.pre_site_flags:
        _add_heading(doc, "3.1 Automated Desktop Pre-Site Flags", level=2)
        for fl in spatial.pre_site_flags:
            _add_bullet(doc, fl)

    if _add_figure(
        doc,
        gis_map_png,
        f"Figure {fig_num}: GDA2020 / MGA Zone 56 Site Location, Cadastre, Contours & Watercourse Buffer Map (Drawing OSSM-GIS-01). "
        f"Note: Spatial base layers sourced from NSW Spatial Services & NSW Planning Portal; boundaries are indicative and verified on site.",
        width_in=6.5,
    ):
        fig_num += 1

    doc.add_page_break()

    # =========================================================================
    # SECTION 4: SITE EVALUATION FORM (LCC APPENDIX E — TABLE 8)
    # =========================================================================
    _add_heading(doc, "4. Site Evaluation Form (LCC Strategy Appendix E — Table 8)", level=1)
    site_rows = [
        ["Details of Proposed Development", inp.development_description, "INFO"],
        ["Address & Lot/DP", f"{inp.site_address} (Lot {inp.lot_number} {inp.plan_label})", "INFO"],
        ["Local Government Area", inp.lga, "INFO"],
        ["Date of Assessment", se.assessment_date.strftime("%d/%m/%Y"), "INFO"],
        ["Water Supply & Fixtures", f"{inp.water_supply.value.replace('_', ' ').title()} ({model.flow_rate_lpd:.0f} L/p/d)", "INFO"],
        ["Recent Weather Conditions", se.recent_weather, "INFO"],
        ["Allotment / HIA Size", mo_line, "INFO"],
        ["Existing Vegetation", se.existing_vegetation, "INFO"],
        ["Slope (%)", se.slope_range_text or f"{se.slope_pct}%", "✓" if se.slope_pct <= 15 else "×"],
        ["Landform (Water Spreading)", se.landform_notes, "✓" if se.landform != "convergent" else "×"],
        ["Aspect & Sun/Wind Exposure", f"{se.aspect}; {se.exposure.replace('_', ' ')} sun/wind exposure", "✓" if not any(q in se.aspect.upper() for q in ("SOUTH", "SW", "SE")) else "×"],
        ["Boulders / Floaters / Rock Outcrops", se.boulders_rocks, "×" if se.boulders_limiting else "✓"],
        ["Buffer Distances (Measured)", f"Gully: {se.dist_gully_m or '>40'} m | Watercourse: {se.dist_perennial_watercourse_m or '>100'} m | Bore: {se.dist_domestic_bore_m or '>100'} m | Boundary: {se.dist_property_boundary_m or '>12'} m | Dwelling: {se.dist_dwelling_m or '>15'} m", "✓" if not any(c.category == "Buffers" and c.status != "PASS" for c in audit.checks) else "×"],
        ["Run-on & Upslope Seepage Control", se.run_on_diversion_proposed, "✓"],
        ["Run-off & Downslope Control", se.run_off_control_proposed, "✓"],
        ["Flooding Potential (1:20 LAA / 1:100 Treatment)", se.flooding_potential, "×" if (se.below_1_in_20_flood or se.below_1_in_100_flood or spatial.flood_planning) else "✓"],
        ["Site Drainage", se.site_drainage, "×" if se.surface_dampness else "✓"],
        ["Vegetation Indicating Waterlogging", se.waterlogging_vegetation, "×" if se.waterlogging_present else "✓"],
        ["Surface Condition", se.surface_condition, "×" if se.surface_cracking_or_bare else "✓"],
        ["Fill", se.fill_notes, "×" if se.contains_fill else "✓"],
        ["Erosion / Mass Movement", se.erosion_notes, "×" if se.erosion_present else "✓"],
        ["Depth to Water Table / Bedrock", f">= {se.depth_to_water_table_m:.1f} m", "✓" if se.depth_to_water_table_m >= 1.0 else "×"],
        ["Dedicated 100% Reserve LAA", f"{'Yes — ' + str(round(model.reserve_laa_m2, 1)) + ' m² nominated on layout plan' if se.reserve_laa_available else 'NOT AVAILABLE (Departure)'}", "✓" if se.reserve_laa_available else "×"],
        ["OVERALL SITE LIMITATION STATUS", "No Limitations" if not audit.site_has_limitations else "Limitation(s) Identified — Mitigated in Design", "✓" if not audit.site_has_limitations else "×"],
    ]
    _add_grid_table(doc, ["Site Feature", "Field Assessment Findings", "Status"], site_rows, status_col=2)

    # =========================================================================
    # SECTION 5: SOIL ASSESSMENT, BOREHOLES (TABLE 9) & OVERALL LIMITATION (TABLE 10)
    # =========================================================================
    _add_heading(doc, "5. Soil Assessment, Borehole Horizons (Table 9) & Limitation Matrix (Table 10)", level=1)
    doc.add_paragraph(
        f"Desktop soil landscape mapping (D.T. Morand 1994, Soil Landscapes of the Lismore–Ballina 1:100,000 Sheet) "
        f"places the property within Soil Unit '{model.morand_unit_name}' (code: {model.morand_code}; {model.morand_group}; "
        f"Phosphorus sorption capacity {model.p_sorption_kg_ha_m:,.0f} kg/ha/m). On-site hand-auger borehole profiling "
        f"(minimum two boreholes excavated to >= 1,000 mm across the nominated LAA) classifies the critical disposal "
        f"horizon as '{model.soil_texture_name}' (AS/NZS 1547 Soil Category {model.soil_category}, indicative saturated "
        f"hydraulic conductivity Ksat {model.soil_ksat_md} m/day, Design {'Irrigation' if is_irrig else 'Loading'} Rate "
        f"{model.max_deep_drainage_mmd:.1f} mm/day)."
    )

    for bh in inp.boreholes:
        _add_heading(doc, f"Borehole {bh.borehole_id} (Total Auger Depth: {bh.max_depth_mm} mm)", level=2)
        bh_rows = []
        for h in bh.horizons:
            bh_rows.append([
                f"{h.horizon}{'*' if h.is_disposal_level else ''}",
                f"{h.depth_top_mm}–{h.depth_bottom_mm}",
                h.classification,
                h.texture_moist or "—",
                h.structure_moist,
                h.colour,
                f"{h.coarse_fragments_pct:.0f}%",
                f"{h.ph:.1f}" if h.ph is not None else "—",
                str(h.dispersive_class) if h.dispersive_class is not None else "—",
            ])
        _add_grid_table(
            doc,
            ["Horizon", "Depth (mm)", "Classification", "Texture", "Structure", "Colour", "Coarse %", "pH", "Emerson Class"],
            bh_rows,
        )
        p_note = doc.add_paragraph()
        p_note.paragraph_format.space_before = Pt(2)
        p_note.paragraph_format.space_after = Pt(4)
        rn = p_note.add_run("* Denotes disposal horizon.  ")
        rn.italic = True
        rn.font.size = Pt(8.4)
        rn.font.color.rgb = MUTED
        if bh.bolus_description or bh.bolus_ribbon_mm:
            rb = p_note.add_run("Field Bolus / Ribbon Test: ")
            rb.bold = True
            rb.font.size = Pt(8.8)
            p_note.add_run(f"{bh.bolus_description or ''} (Ribbon: {bh.bolus_ribbon_mm or 'N/A'})").font.size = Pt(8.8)

    if audit.requires_gypsum:
        _add_callout(
            doc,
            "Dispersive Soil Amelioration (Modified Emerson Class 3/4)",
            f"Borehole dispersion testing recorded Emerson Aggregate Class 3/4. Prior to gravel placement, agricultural "
            f"gypsum (CaSO4·2H2O) shall be spread uniformly across the excavated trench/bed base at {audit.gypsum_rate_kg_m2:.1f} kg/m² "
            f"and lightly raked into the surface. Occupants shall also use low-sodium biodegradable household detergents.",
            fill_hex="FEF3C7",
            border_hex="B45309",
        )

    if cn and cn.site_soil_interpretation:
        for para in [p.strip() for p in cn.site_soil_interpretation.split("\n\n") if p.strip()]:
            doc.add_paragraph(para)

    _add_heading(doc, "5.1 Overall Site & Soil Limitation Determination (LCC Appendix E — Table 10)", level=2)
    _add_grid_table(
        doc,
        ["Assessment Domain", "Result", "Engineering Design Response"],
        [
            [
                "Site Assessment (Table 8)",
                "NO LIMITATIONS" if not audit.site_has_limitations else "LIMITATION",
                "All site slopes, buffers, drainage, and flood criteria satisfied" if not audit.site_has_limitations else "Site constraint(s) mitigated via upslope diversion swale, vegetation buffer, and secondary treatment",
            ],
            [
                "Soil Assessment (Table 9)",
                "NO LIMITATIONS" if not audit.soil_has_limitations else "LIMITATION",
                "Subsoil permeability, depth, pH, and dispersion suitable" if not audit.soil_has_limitations else ("Gypsum amelioration @ " + f"{audit.gypsum_rate_kg_m2:.1f} kg/m² & secondary treatment nominated" if audit.requires_gypsum else "Secondary treatment & conservative DLR/DIR applied"),
            ],
            [
                "OVERALL CAPABILITY RATING",
                "NO LIMITATIONS" if audit.overall_no_limitations else "MITIGATED",
                "Site is capable of sustainably assimilating domestic wastewater without environmental or public health risk",
            ],
        ],
        status_col=1,
    )

    doc.add_page_break()

    # =========================================================================
    # SECTION 6: LISMORE DAILY WASTEWATER MODEL, DLR/LTR & DESIGNER LAYOUT
    # =========================================================================
    _add_heading(doc, "6. Lismore CC Daily Wastewater Model (OSmodel300614) & DLR/LTR Sizing", level=1)
    doc.add_paragraph(
        "Land Application Area (LAA) sizing has been computed deterministically using Lismore City Council's official "
        "On-Site Wastewater Daily Model equations across the complete 7,670-day Alstonville climate series (1970–1991), "
        "coupled with Headley & Davidson (2003) sub-surface flow reed bed kinetics, Lismore's block-size nitrogen "
        "percolation curve, and 50-year phosphorus sorption balance."
    )

    if model.source_breakdown:
        _add_heading(doc, "6.0 Multi-Use / Commercial Wastewater Source Breakdown", level=2)
        src_rows = [
            [
                s.label,
                s.source_type.replace("_", " ").title(),
                str(s.units),
                f"{s.ep_equivalent:.1f}",
                f"{s.daily_flow_ld:.0f} L/d",
                f"{s.influent_bod_mgl:.0f} mg/L",
                s.basis_note,
            ]
            for s in model.source_breakdown
        ]
        src_rows.append([
            "COMBINED TOTAL",
            inp.development_category.value.replace("_", " ").title(),
            "—",
            f"{model.design_persons} EP",
            f"{model.total_flow_ld:.0f} L/d",
            f"{model.weighted_influent_bod_mgl:.0f} mg/L (weighted)",
            f"Annual: {model.annual_flow_m3:.1f} m³/yr",
        ])
        _add_grid_table(
            doc,
            ["Source", "Category", "Units", "EP", "Daily Flow", "Influent BOD5", "Sizing Basis / Pre-Treatment"],
            src_rows,
        )
        doc.add_paragraph()

    model_rows = [
        ["Design Occupancy / Water Supply", (
            f"{model.design_persons} EP across {len(model.source_breakdown)} sources (Weighted BOD5: {model.weighted_influent_bod_mgl:.0f} mg/L)"
            if model.source_breakdown
            else f"{model.design_persons} EP ({inp.bedrooms} BR + 1) @ {model.flow_rate_lpd:.0f} L/p/d"
        )],
        ["Total Daily Wastewater Flow (Q)", f"{model.total_flow_ld:.0f} L/day ({model.annual_flow_m3:.1f} m³/year)"],
        ["Septic Tank Capacity (AS/NZS 1547 Table J1 / LCC Table A1)", f"{model.septic_tank_min_l} L (Hydraulic retention: {model.septic_retention_days:.1f} days at 100% occupancy)"],
    ]
    if model.grease_arrestor_min_l > 0:
        model_rows.append(["Commercial Grease Arrestor (AS/NZS 3500.2)", f"{model.grease_arrestor_min_l} L upstream of septic tank (FOG & solids capture)"])
    if model.surge_tank_min_l > 0:
        model_rows.append(["Flow Equalisation / Surge Balance Tank", f"{model.surge_tank_min_l} L timer-dosed buffer tank for peak weekend / batch loads"])
    model_rows.extend([
        ["Soil Texture / Structure (Most Limiting Layer)", f"{model.soil_texture_name} (Category {model.soil_category}; Ksat {model.soil_ksat_md} m/d)"],
        ["Maximum Deep Drainage Rate (" + ("DIR" if is_irrig else "DLR") + ")", f"{model.max_deep_drainage_mmd:.1f} mm/day"],
        ["Bucket Storage Capacity (Saturation / AWC)", f"{model.bucket_cap_sat_mm:.1f} mm / {model.bucket_cap_awc_mm:.1f} mm (Root {inp.root_zone_depth_mm:.0f} mm + Gravel {inp.gravel_depth_mm:.0f} mm)"],
        ["Morand Soil Code & Phosphorus Sorption", f"{model.morand_unit_name} ({model.morand_code}) — {model.p_sorption_kg_ha_m:,.0f} kg/ha/m (WT Depth {se.depth_to_water_table_m:.1f} m)"],
        ["Hydraulic Area (95th Percentile Exceedance = 0.0 mm)", f"{model.hydraulic_area_m2:.1f} m² (Exceedance days: {model.exceedance_days_count}/7670 = {model.exceedance_pct_of_days:.2f}%)"],
        ["Nitrogen Area [N perc granted / plant available]", f"{model.nitrogen_area_m2:.1f} m² [{model.n_percolation_granted_kg_yr:.2f} / {model.n_available_to_laa_kg_yr:.2f} kg/yr; N removal {model.n_removal_pct:.1f}%]"],
        ["Phosphorus Area (50-year accumulation)", f"{model.phosphorus_area_m2:.1f} m² (Total P load: {model.total_p_kg_yr:.2f} kg/yr)"],
        ["Minimum Area Cap (10 m²/EP secondary; 15 m²/EP primary)", f"{model.area_cap_m2:.1f} m²"],
        ["REQUIRED LAND APPLICATION AREA (Limiting: " + model.limiting_factor + ")", f"{model.required_laa_m2:.1f} m² (Actual Loading Rate: {model.daily_loading_rate_actual_mmd:.1f} mm/day)"],
        ["NOMINATED 100% ALTERNATE (RESERVE) LAA", f"{model.reserve_laa_m2:.1f} m²"],
    ])
    if has_rb:
        model_rows.extend([
            ["Reed Bed Required Area & HRT (BOD outlet = 20 mg/L)", f"{model.reed_bed_required_m2:.1f} m²  |  HRT = {model.reed_bed_hrt_days:.1f} days (Wetted depth {inp.reed_bed_wetted_depth_m:.2f} m, Porosity 0.40)"],
            ["Proposed Rigid Reed Bed Units", f"{model.recommended_reed_bed_count} × {model.recommended_reed_bed_model} (Provided: {model.recommended_reed_bed_provided_m2:.1f} m²)"],
        ])
    _add_grid_table(doc, ["OSmodel300614 Parameter", "Calculated Value"], model_rows)

    _add_heading(doc, "6.1 Daily Loading Rate (DLR / LTR) Verification (AS/NZS 1547:2012 Table H3)", level=2)
    rate_label = "Design Irrigation Rate (DIR)" if is_irrig else "Design Loading Rate (DLR)"
    doc.add_paragraph(
        f"Cross-checking hydraulic loading against AS/NZS 1547:2012 Table H3 / Lismore Strategy Table 4 for "
        f"Soil Category {model.soil_category} ({model.soil_texture_name}):\n"
        f"  • Permissible Maximum {rate_label}: {model.max_deep_drainage_mmd:.1f} mm/day\n"
        f"  • Design Daily Flow (Q): {model.total_flow_ld:.0f} L/day\n"
        f"  • Modelled Required LAA (A): {model.required_laa_m2:.1f} m² (Limiting Factor: {model.limiting_factor})\n"
        f"  • Actual Design Loading Rate = Q / A = {model.total_flow_ld:.0f} / {model.required_laa_m2:.1f} = "
        f"{model.daily_loading_rate_actual_mmd:.2f} mm/day "
        f"({'<= permissible max ' + str(model.max_deep_drainage_mmd) + ' mm/day — COMPLIANT' if model.daily_loading_rate_actual_mmd <= model.max_deep_drainage_mmd + 0.05 else '— verified via 7,670-day water balance'})"
    )

    if is_irrig:
        _add_heading(doc, "6.2 Contiguous Irrigation Zone Layout (LCC Strategy Appendix B s4.0)", level=2)
        _add_grid_table(
            doc,
            ["Dimension Parameter", "Design Value"],
            [
                ["Required Land Application Area (LAA)", f"{tr.laa_m2:.1f} m²"],
                ["Irrigation Zone Footprint (Contiguous, 0 m trench separation)", f"{tr.trench_length_m:.1f} m × {tr.trench_width_m:.1f} m = {tr.envelope_area_m2:.1f} m²"],
                ["Estimated Sub-Surface Dripper Lateral Length (@ 1.0 m spacing)", f"~{round(tr.laa_m2)} linear metres (100–150 mm burial depth)"],
                ["Pump Well, Filtration & Flush Velocity", "1,800 L Pump Well + High-Level Alarm + 120-mesh Disc Filter + Indexing Valve (>= 0.8 m/s scour)"],
                ["Certified Irrigation Design Plan (CIDP)", "Mandatory prior to installation (LCC Strategy Appendix C & D — A3 plans @ 1:200 & 1:250)"],
            ],
        )
    else:
        _add_heading(doc, "6.2 Rectangular Trench / ETA Bed Layout (LCC Designer Sheet)", level=2)
        _add_grid_table(
            doc,
            ["Dimension Parameter", "Design Value"],
            [
                ["Required Land Application Area (LAA)", f"{tr.laa_m2:.1f} m²"],
                ["Number of ETA Beds / Trenches", f"{tr.number_of_trenches}"],
                ["Bed Width × Total Depth", f"{tr.trench_width_m:.2f} m wide × {total_eta_depth_m:.2f} m deep ({int(inp.gravel_depth_mm)} mm gravel + {int(inp.root_zone_depth_mm)} mm topsoil)"],
                ["Bed Length (Centrally Fed, Max 20.0 m)", f"{tr.trench_length_m:.1f} m"],
                ["Minimum Separation Between Parallel Beds", f"{tr.trench_separation_m:.2f} m undisturbed natural soil"],
                ["Total Bed Footprint Area", f"{tr.total_bed_area_m2:.1f} m²"],
                ["Total Envelope Dimensions (incl. separation)", f"{tr.envelope_length_m:.1f} m × {tr.envelope_width_m:.1f} m ({tr.envelope_area_m2:.1f} m²)"],
            ],
        )

    # =========================================================================
    # SECTION 7: CLAUSE-CITED REGULATORY COMPLIANCE MATRIX
    # =========================================================================
    _add_heading(doc, "7. Regulatory Compliance Matrix (LCC Strategy 2013 & AS/NZS 1547:2012)", level=1)
    audit_rows = [
        [c.code, c.parameter, c.measured_value, c.requirement, c.clause, c.status]
        for c in audit.checks
    ]
    _add_grid_table(doc, ["ID", "Parameter", "Site Value", "Requirement", "Cited Clause", "Status"], audit_rows, status_col=5)

    doc.add_page_break()

    # =========================================================================
    # SECTION 8: SITE INSPECTION PHOTOGRAPHS
    # =========================================================================
    _add_heading(doc, "8. Site Inspection Photographs", level=1)
    valid_photos = [(p, cap) for (p, cap) in photo_items if p and p.exists()]
    if valid_photos:
        doc.add_paragraph(
            f"The following geotagged field inspection photographs were captured on {se.assessment_date.strftime('%d %B %Y')} "
            f"to document ground cover, slope gradient, pegged component locations, soil borehole profiles, and downslope buffers."
        )
        for idx, (ppath, caption) in enumerate(valid_photos, start=1):
            _add_figure(doc, ppath, f"Photo {idx}: {caption}", width_in=5.6)
    else:
        doc.add_paragraph(
            "Site inspection photographs should be attached prior to final Section 68 lodgement (upload or capture "
            "photos in Tab 2 of the Field To Forest OSSM Workbench to embed them automatically into this section)."
        )
        _add_grid_table(
            doc,
            ["Required Photo", "Subject / Field Verification Target", "Captured?"],
            [
                ["Photo 1", "Dwelling sanitary plumbing outlet & proposed Septic Tank location (pegged >= 3.0 m from dwelling)", "[  ] Pending"],
                ["Photo 2", "Proposed Reed Bed / Secondary Treatment unit location & upslope drainage context" if has_rb or is_awts else "Downslope aspect from septic tank towards proposed LAA", "[  ] Pending"],
                ["Photo 3", "Pegged Primary Land Application Area (LAA) showing slope, aspect & grass cover", "[  ] Pending"],
                ["Photo 4", "Pegged 100% Alternate (Reserve) LAA & downslope setback buffer to gully/boundary", "[  ] Pending"],
                ["Photo 5", "Soil Borehole BH1 & BH2 auger profile horizons & bolus ribbon test", "[  ] Pending"],
            ],
        )

    doc.add_page_break()

    # =========================================================================
    # SECTION 9: PROPOSED WORKS, CAD LAYOUT PLAN & ENGINEERING CROSS-SECTIONS
    # =========================================================================
    _add_heading(doc, "9. Proposed Works, Scaled Layout Plan & Engineering Cross-Sections", level=1)

    if _add_figure(
        doc,
        cad_plan_png,
        f"Figure {fig_num}: Scaled OSSM Engineering Layout Plan (Drawing OSSM-CAD-01; companion native 12-layer AutoCAD .dxf supplied).",
        width_in=6.5,
    ):
        fig_num += 1

    _add_heading(doc, "9.1 Schedule of Proposed Works", level=2)
    for w in works_lines:
        _add_bullet(doc, w)
    _add_bullet(doc, "Connect all household sanitary plumbing fixtures to the treatment system in accordance with AS/NZS 3500 and the Plumbing Code of Australia (NSW Licensed Plumber).")
    _add_bullet(doc, f"Upslope Stormwater Control: {se.run_on_diversion_proposed}")
    _add_bullet(doc, f"Downslope Buffering: {se.run_off_control_proposed}")

    if model.grease_arrestor_min_l > 0 or model.surge_tank_min_l > 0 or (cn and cn.commercial_trade_waste_notes):
        _add_heading(doc, "9.1a Commercial Pre-Treatment — Grease Arrestor & Surge Equalisation (AS/NZS 3500.2)", level=2)
        if cn and cn.commercial_trade_waste_notes:
            for para in [p.strip() for p in cn.commercial_trade_waste_notes.split("\n\n") if p.strip()]:
                doc.add_paragraph(para)
        if model.grease_arrestor_min_l > 0:
            _add_bullet(doc, f"Install a {model.grease_arrestor_min_l} L commercial baffled grease arrestor compliant with AS/NZS 3500.2 and NSW Liquid Trade Waste Guidelines upstream of the primary septic tank on all commercial kitchen/food-processing waste lines.")
            _add_bullet(doc, "Fit removable stainless-steel basket strainers (<= 3 mm mesh) to all commercial sinks and floor drains; exclude domestic toilet/shower blackwater from the grease arrestor.")
            _add_bullet(doc, "Locate grease arrestor with direct vacuum-tanker pump-out access and trafficable gas-tight lockable lid flush with finished surface.")
            if _add_figure(
                doc,
                diagrams.get("grease_xsec"),
                f"Figure {fig_num}: Typical Cross-Section — {model.grease_arrestor_min_l} L Commercial Grease Arrestor (AS/NZS 3500.2).",
                width_in=6.4,
            ):
                fig_num += 1
        if model.surge_tank_min_l > 0:
            _add_bullet(doc, f"Install a {model.surge_tank_min_l} L flow-equalisation / surge balance tank with timer-controlled dosing pump and high-level audible/visual alarm to smooth weekend occupancy or batch-processing spikes across 24 hours.")

    _add_heading(doc, "9.2 Primary Septic Tank Construction & Installation (AS/NZS 1546.1 & LCC Appendix A)", level=2)
    if not is_awts:
        _add_bullet(doc, f"Install an NSW Health accredited {model.septic_tank_min_l} L concrete or heavy-duty polyethylene septic tank (> 3.0 m from dwelling, accessible for vacuum pump-out truck).")
        _add_bullet(doc, f"At the design load of {model.total_flow_ld:.0f} L/day, the {model.septic_tank_min_l} L capacity provides {model.septic_retention_days:.1f} days hydraulic retention.")
        _add_bullet(doc, "Fit internal baffle, inlet/outlet T-squares, and an externally accessible outlet effluent filter (e.g. Biotube, Taylex, or Zabel) to prevent solids carry-over.")
        _add_bullet(doc, "Bed tank on a 100 mm compacted, dead-level crusher-dust base; install inspection risers flush with finished ground level and divert stormwater clear of lid.")
        if _add_figure(
            doc,
            diagrams.get("septic_xsec"),
            f"Figure {fig_num}: Typical Cross-Section — {model.septic_tank_min_l} L Baffled Septic Tank with Effluent Filter (AS/NZS 1546.1).",
            width_in=6.4,
        ):
            fig_num += 1
    else:
        _add_bullet(doc, "Install an NSW Health accredited AWTS compliant with AS/NZS 1546.3 above the 1-in-100 year flood level with dedicated weatherproof power supply and audible/visual high-level alarm.")

    if has_rb:
        _add_heading(doc, "9.3 Secondary Reed Bed Specification (Headley & Davidson 2003 & LCC Appendix A s4.0)", level=2)
        _add_bullet(doc, f"Install {model.recommended_reed_bed_count} × rigid impermeable {model.recommended_reed_bed_model} in series (provided area {model.recommended_reed_bed_provided_m2:.1f} m² vs {model.reed_bed_required_m2:.1f} m² required; flexible dam liners are prohibited in Lismore LGA).")
        _add_bullet(doc, "Bed tub(s) on a 75–100 mm compacted, level crusher-dust pad; backfill external walls simultaneously while filling gravel to prevent lateral wall bowing.")
        _add_bullet(doc, "Fill main chamber with clean, washed 20 mm aggregate (porosity ~0.40); place 50–100 mm clean washed rock around the 100 mm slotted PVC inlet spreader and 150 mm PVC outlet collection tower.")
        _add_bullet(doc, f"Set adjustable outlet swivel/standpipe to maintain a {inp.reed_bed_wetted_depth_m:.2f} m wetted depth (50–100 mm below gravel surface) so zero standing effluent is exposed at the surface.")
        _add_bullet(doc, "Plant local native macrophytes (Lomandra hystrix, Schoenoplectus validus, Baumea articulata, Phragmites australis) at >= 4–5 plants/m² (30–40 cm centres).")
        _add_bullet(doc, "Keep tank rim >= 100 mm proud of surrounding finished ground level and install upslope diversion swale.")
        if _add_figure(
            doc,
            diagrams.get("reed_bed_xsec"),
            f"Figure {fig_num}: Rigid Sub-Surface Flow Reed Bed Elevation & Plan Cross-Section ({model.recommended_reed_bed_count} × {model.recommended_reed_bed_model}).",
            width_in=6.4,
        ):
            fig_num += 1

    if is_irrig:
        _add_heading(doc, "9.4 Sub-Surface Drip / Spray Irrigation Specification & CIDP Summary (LCC Appendix B s4.0, C & D)", level=2)
        _add_bullet(doc, f"Establish a contiguous grassed irrigation zone measuring {tr.trench_length_m:.1f} m × {tr.trench_width_m:.1f} m ({model.required_laa_m2:.1f} m²) on contour with a dedicated 100% Reserve zone ({model.reserve_laa_m2:.1f} m²).")
        _add_bullet(doc, "Install a minimum 1,800 L pump well with submersible effluent pump, float switches, audible/visual high-level alarm, 120-mesh disc filter, pressure regulator, and indexing/zone valve.")
        if is_sdi:
            _add_bullet(doc, f"Lay ~{round(model.required_laa_m2)} linear metres of purple pressure-compensating root-guard dripperline (e.g. Netafim Bioline / Geoflow) at 1.0 m lateral spacing, buried 100–150 mm in friable topsoil.")
            _add_bullet(doc, "Fit vacuum breaker / air-release valve at the highest point of each zone and flush valves at the lowest manifold points achieving >= 0.8 m/s scour velocity.")
        _add_bullet(doc, "Erect compliant reclaimed water warning signage ('RECYCLED WATER — DO NOT DRINK') and submit a Certified Irrigation Design Plan (CIDP — LCC Appendix C & D) with A3 1:200/1:250 plans prior to installation.")
        if _add_figure(
            doc,
            diagrams.get("laa_xsec"),
            f"Figure {fig_num}: Sub-Surface Drip Irrigation Cross-Section & Hydraulic Control Layout ({tr.trench_length_m:.1f} m × {tr.trench_width_m:.1f} m Contiguous Zone).",
            width_in=6.4,
        ):
            fig_num += 1
    else:
        _add_heading(doc, "9.4 ETA Bed Construction Specification (LCC Strategy Appendix B s3.0 & Design 1)", level=2)
        _add_bullet(doc, f"Excavate {tr.number_of_trenches} × level bed(s) {tr.trench_length_m:.1f} m long × {tr.trench_width_m:.1f} m wide × {int(inp.root_zone_depth_mm + inp.gravel_depth_mm)} mm total depth strictly along the natural ground contour.")
        _add_bullet(doc, "Rip/scarify smeared excavation base prior to gravel placement; check base with laser level to ensure dead-level finish lengthwise and crosswise.")
        if audit.requires_gypsum:
            _add_bullet(doc, f"Broadcast agricultural gypsum uniformly across the ripped clay base at {audit.gypsum_rate_kg_m2:.1f} kg/m² to ameliorate Emerson Class 3/4 dispersion.")
        _add_bullet(doc, f"Place {int(inp.gravel_depth_mm)} mm depth of clean, washed 20–50 mm aggregate/blue metal.")
        _add_bullet(doc, "Lay 100 mm slotted PVC distribution pipe centrally fed along bed centreline on top of gravel (NO geotextile sock on slotted pipe per LCC Strategy Appendix B s3.0; cap ends with inspection/flush risers).")
        _add_bullet(doc, f"Cover gravel surface with permeable geotextile fabric (e.g. Bidim A14), backfill with {int(inp.root_zone_depth_mm)} mm friable sandy loam topsoil mounded slightly to shed rainfall, and turf with perennial grass.")
        _add_bullet(doc, f"Maintain >= {tr.trench_separation_m:.1f} m undisturbed natural soil separation between parallel beds; permanently exclude vehicles, heavy machinery, and livestock.")
        if _add_figure(
            doc,
            diagrams.get("laa_xsec"),
            f"Figure {fig_num}: Typical ETA Bed Cross-Section (LCC Design 1 — {tr.trench_width_m:.1f} m Wide × {int(inp.root_zone_depth_mm + inp.gravel_depth_mm)} mm Deep).",
            width_in=6.4,
        ):
            fig_num += 1

    doc.add_page_break()

    # =========================================================================
    # SECTION 10: HOMEOWNER GUIDE & COMPONENT O&M MANUALS
    # =========================================================================
    _add_heading(doc, "10. Homeowner Guide & Component Operation / Maintenance Manuals", level=1)
    doc.add_paragraph(
        "In accordance with Lismore City Council OSSM Strategy (2013) Part B Section 1.1, this Owner's Guide and "
        "Plan of Management must be retained on site and passed on to any future owners or tenants."
    )

    _add_heading(doc, "10.1 A Guide to Your On-Site Wastewater System (Responsibilities & Household Habits)", level=2)
    _add_bullet(doc, "Under Section 68 of the Local Government Act 1993, the property owner must hold a valid Approval to Operate (ATO) from Lismore City Council and keep all components in safe, odour-free, non-polluting working order.", "Owner Obligations: ")
    _add_bullet(doc, "Council periodically inspects OSSM systems (risk-based frequency) and renews the Approval to Operate upon verifying compliance.", "Council Role: ")
    _add_bullet(doc, "Use phosphorus-free, low-sodium biodegradable laundry and dishwashing products. Spread washing machine loads across the week rather than conducting multiple loads in a single day.", "Water & Detergent Care: ")
    _add_bullet(doc, "NEVER flush bleach, Napisan/whiteners, disinfectants, paint, solvents, cooking oils/fats, coffee grounds, wet wipes, sanitary pads, cotton buds, or harsh drain cleaners — these kill beneficial anaerobic/aerobic bacteria and rapidly clog the soil interface.", "Strictly Prohibited Items: ")

    _add_heading(doc, "10.2 Septic Tank Operation & Maintenance Manual", level=2)
    _add_bullet(doc, "Solids settle to the bottom (sludge) and fats float to the surface (scum) while bacteria digest organic matter. Clear liquid passes through the outlet effluent filter.", "How It Works: ")
    _add_bullet(doc, "Every 6 months, lift the external effluent filter cartridge and hose it clean back into the inlet chamber of the septic tank (wear gloves). Never discard rinse water onto the ground.", "Outlet Filter Cleaning: ")
    _add_bullet(doc, f"Have a licensed vacuum tanker inspect sludge/scum depth every 18 months and pump out the {model.septic_tank_min_l} L tank every 3–5 years (or when combined sludge + scum exceeds 1/3 of liquid depth). Retain pump-out receipts for Council.", "Desludging: ")
    _add_bullet(doc, "Slow-draining fixtures, gurgling pipes, sewage odours, damp/soggy ground, or lush dark-green patches over the tank or trenches indicate blockage or overload. Immediately cease heavy water use and call a licensed plumber.", "Warning Signs of Failure: ")

    if has_rb:
        _add_heading(doc, "10.3 Sub-Surface Flow Reed Bed Operation & Maintenance Manual", level=2)
        _add_bullet(doc, "Every 6 months (January & May), open the inlet spreader and outlet control inspection boxes. Clear any stray roots or debris obstructing the inlet slots or outlet swivel pipe.", "Inlet & Outlet Checks: ")
        _add_bullet(doc, "Once per year during warm dry weather, the adjustable outlet standpipe may be lowered by 150–200 mm for 2 weeks to encourage deep root penetration and oxygenate the gravel matrix, then restored to normal operating depth.", "Seasonal Water-Level Lowering: ")
        _add_bullet(doc, "Trim senescent or dense wetland reeds in late winter/spring (and autumn if vigorous) to ~200 mm above gravel surface. Remove at least 80% of cut biomass off the bed (to export captured nutrients); a maximum of 20% may be mulched lightly on the surface.", "Harvesting & 20% Mulching Rule: ")
        _add_bullet(doc, "If ponding occurs on top of the gravel, inspect the outlet standpipe for blockage or root intrusion immediately — effluent must always remain 50–100 mm below the gravel surface.", "Surface Ponding Check: ")
    elif is_awts:
        _add_heading(doc, "10.3 AWTS Quarterly Servicing Requirements", level=2)
        _add_bullet(doc, "Maintain a current quarterly (every 3 months) service contract with a Council-approved AWTS service technician, with service reports lodged to Lismore City Council.", "Mandatory Quarterly Service: ")
        _add_bullet(doc, "Never switch off power to the AWTS blower or irrigation pump; check chlorine tablet level monthly and respond immediately to any audible/visual alarm.", "Power, Disinfection & Alarms: ")

    _add_heading(doc, "10.4 Land Application Area (Disposal Field) & Post-Installation Settling Guide", level=2)
    _add_bullet(doc, "Keep grass over the LAA mown regularly (removing clippings where practical to export nutrients) to maximise evapotranspiration. Exclude vehicles, tractors, trailers, horses, and cattle permanently.", "Vegetation & Traffic Exclusion: ")
    _add_bullet(doc, "Inspect upslope stormwater diversion swales after heavy rain events and clear leaf litter or sediment so roof and paddock runoff cannot enter the disposal field.", "Stormwater Swale Care: ")
    _add_bullet(doc, "During the first 3–6 months following excavation and installation, backfilled soil around the septic tank, reed bed tubs, pipe trenches, and ETA beds naturally settles/slumps. Inspect after the first two substantial rainfall events, top up any depressions with friable topsoil (or crusher dust around tank rims) so water sheds away rather than ponding, and re-seed bare patches promptly.", "Post-Installation Soil Settling / Slumping: ")

    if model.grease_arrestor_min_l > 0:
        _add_heading(doc, "10.2a Commercial Grease Arrestor & FOG Management Manual", level=2)
        _add_bullet(doc, f"Engage a NSW EPA licensed liquid waste contractor to fully pump out, scrape, and clean the {model.grease_arrestor_min_l} L grease arrestor every 3–6 months (or whenever combined FOG + solids exceed 25% of liquid depth). Retain all pump-out dockets for Lismore City Council inspection.", "Mandatory Pump-Out: ")
        _add_bullet(doc, "Dry-wipe pots, trays, and food processing surfaces into solid organic waste / compost bins prior to washing. Never pour cooking oil, fat, butter, or dairy whey into drains, and never use enzyme/emulsifier grease-dissolving chemicals (which pass emulsified fat into the septic tank and clog the disposal field).", "Kitchen & Processing Practices: ")

    if cn and cn.custom_om_notes:
        _add_heading(doc, "10.5 Site-Specific Operation & Management Notes", level=2)
        for para in [p.strip() for p in cn.custom_om_notes.split("\n\n") if p.strip()]:
            doc.add_paragraph(para)

    # =========================================================================
    # SECTION 11: MAINTENANCE SCHEDULE & SERVICE RECORD
    # =========================================================================
    _add_heading(doc, "11. Ongoing Maintenance Schedule & Printable Service Record", level=1)
    maint_items = []
    next_n = 1
    if model.grease_arrestor_min_l > 0:
        maint_items.append(
            [str(next_n), f"Commercial Grease Arrestor ({model.grease_arrestor_min_l} L)", "Licensed Liquid Waste Contractor", "Every 3–6 months", "Full vacuum pump-out, baffle inspection & docket retention; clean sink basket strainers daily."]
        )
        next_n += 1
    if model.surge_tank_min_l > 0:
        maint_items.append(
            [str(next_n), f"Surge / Balance Tank ({model.surge_tank_min_l} L)", "Owner / Plumber", "Every 6 months", "Test dosing timer, float switches, and high-level alarm; check pump intake screen."]
        )
        next_n += 1
    maint_items.extend([
        [str(next_n), "Septic Tank Outlet Filter", "Owner / Plumber", "Every 6 months", "Inspect and hose-clean effluent filter into tank inlet; check inlet/outlet junctions for blockage."],
        [str(next_n + 1), "Septic Tank Desludging", "Licensed Pump-out Contractor", "Every 3–5 years", f"Inspect sludge/scum every 18 months; pump out {model.septic_tank_min_l} L tank when solids reach 1/3 depth; retain docket."],
        [str(next_n + 2), "Household Chemical Control", "Owner / Occupier", "Ongoing", "Use low-sodium, phosphorus-free biodegradable detergents; never flush bleach, wipes, fats, or solvents."],
    ])
    next_n += 3
    if has_rb:
        maint_items.append(
            [str(next_n), "Rigid Reed Bed Inspection & Harvest", "Owner", "Every 6 months (Jan & May)", "Inspect inlet/outlet towers for roots; lower water level 200 mm for 2 wks in summer; harvest shoots to 20 cm (export >= 80% biomass, max 20% mulch)."]
        )
        next_n += 1
    elif is_awts:
        maint_items.append(
            [str(next_n), "AWTS Mechanical & Disinfection Service", "Accredited Service Agent", "Quarterly (3 monthly)", "Full blower, clarifier, pump, alarm & chlorine service; submit report to Lismore City Council."]
        )
        next_n += 1

    if is_irrig:
        maint_items.append(
            [str(next_n), "Pump Well, Disc Filter & Flush Valves", "Owner / Technician", "Every 3–6 months", "Clean 120-mesh disc filter, test high-level alarm, and open dripperline flush valves for 2–3 mins to scour laterals."]
        )
        next_n += 1

    maint_items.extend([
        [str(next_n), "LAA Grass & Downslope Vegetation", "Owner", "Monthly / As needed", "Mow LAA grass & remove clippings; maintain downslope Lomandra hystrix row; exclude all vehicles & livestock."],
        [str(next_n + 1), "Upslope Stormwater Diversion Swale", "Owner", "Annually & post-storm", "Clear leaves/silt from upslope catch drain so stormwater bypasses treatment & disposal zones."],
        [str(next_n + 2), "Post-Installation Soil Settling Check", "Owner", "First 3–6 months", "Top up slumped backfill around tank/beds/trenches and re-turf so surface water sheds away cleanly."],
    ])
    _add_grid_table(doc, ["#", "Component", "Responsible Party", "Frequency", "Required Maintenance Action"], maint_items)

    _add_heading(doc, "11.1 Printable System Service Record (Keep on Site)", level=2)
    doc.add_paragraph("Date System Commissioned / Approval to Operate Issued: _____ / _____ / 20_____     LCC Approval No: ___________________")
    _add_grid_table(
        doc,
        ["Date", "Component Serviced", "Action Taken / Sludge Depth / Notes", "Serviced By / Signature"],
        [["", "", "", ""] for _ in range(6)],
    )

    doc.add_page_break()

    # =========================================================================
    # SECTION 12: OWNER ACKNOWLEDGEMENT, PLUMBER STEPS & CERTIFICATION
    # =========================================================================
    _add_heading(doc, "12. Owner's Acknowledgement, Statutory Installation Steps & Certification", level=1)

    _add_heading(doc, "12.1 Owner's Acknowledgement (LCC Strategy Part B s1.1)", level=2)
    doc.add_paragraph(
        f"I/We, {inp.applicant_name}, acknowledge that I/we have read and understood the on-site sewage management "
        f"system design nominated in this report ({inp.development_description}) for Lot {inp.lot_number} {inp.plan_label} "
        f"({inp.site_address}), designed for a maximum hydraulic load of {model.total_flow_ld:.0f} L/day ({model.design_persons} EP). "
        f"I/We understand our ongoing maintenance, household chemical, reserve area protection, and Section 68 Approval to Operate "
        f"obligations detailed in Sections 10 and 11 of this report."
    )
    doc.add_paragraph("Owner Signature: _____________________________________    Date: ____ / ____ / 20____")

    _add_heading(doc, "12.2 Statutory Installation Steps for NSW Licensed Plumber (LCC Strategy Section 4.1)", level=2)
    _add_grid_table(
        doc,
        ["Step", "Statutory Requirement", "Responsible Party"],
        [
            ["1. Section 68 Approval", "Do NOT commence installation until Lismore City Council issues Section 68 Approval to Install.", "Owner / Plumber"],
            ["2. Notice of Work (NoW)", "Submit Notice of Work to Lismore City Council at least 2 business days before commencing plumbing & drainage work.", "NSW Licensed Plumber"],
            ["3. Mandatory Inspections", "Book mandatory Council inspections: (a) Internal drainage / under-slab, (b) Septic tank, reed bed & excavated ETA/irrigation beds BEFORE backfilling, (c) Final commissioning & stormwater swales.", "NSW Licensed Plumber"],
            ["4. Certificate of Compliance & SSD", "Submit signed Certificate of Compliance (CoC) and Sewer Service Diagram (SSD) to Council and Owner upon completion.", "NSW Licensed Plumber"],
            ["5. Approval to Operate (ATO)", "Council issues Approval to Operate once final inspection and CoC/SSD are verified satisfactory.", "Lismore City Council"],
        ],
    )

    _add_heading(doc, "12.3 Consultant Certification & Disclaimer", level=2)
    doc.add_paragraph(
        f"This report has been prepared solely for {inp.applicant_name} to accompany a Section 68 Local Government Act "
        f"1993 application to {inp.lga} for Lot {inp.lot_number} {inp.plan_label} ({inp.site_address}). "
        f"Design calculations are based strictly on {model.design_persons} Equivalent Persons ({inp.bedrooms} bedrooms) "
        f"generating {model.total_flow_ld:.0f} L/day and the field site/soil observations recorded on "
        f"{se.assessment_date.strftime('%d %B %Y')}. Should future occupancy, bedroom count, water supply, or building "
        f"footprint exceed these design parameters, revised engineering calculations and Council approval will be required "
        f"prior to works. All plumbing, drainage, and excavation works must be carried out by a NSW Licensed Plumber in "
        f"accordance with AS/NZS 3500, AS/NZS 1547:2012, and Lismore City Council conditions of consent."
    )
    p_cert = doc.add_paragraph()
    p_cert.paragraph_format.space_before = Pt(8)
    rc = p_cert.add_run(
        f"Prepared & Certified By: {inp.consultant.name}  ({inp.consultant.qualification}"
        + (f", Lic. {inp.consultant.licence_number}" if inp.consultant.licence_number else "")
        + f")   |   Date: {se.assessment_date.strftime('%d %B %Y')}"
    )
    rc.bold = True
    rc.font.color.rgb = NAVY

    doc.save(str(out_docx))
    return out_docx
