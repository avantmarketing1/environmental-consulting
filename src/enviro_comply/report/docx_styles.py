"""Shared Microsoft Word (.docx) typography, pagination, TOC, header/footer & photo-grid helpers.

Pure python-docx (zero matplotlib dependency) so desktop Python CLI and browser Pyodide produce
identical, print-ready, council-grade engineering & planning reports.
"""

from __future__ import annotations

from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn
from docx.shared import Inches, Pt, RGBColor

NAVY = RGBColor(0x0D, 0x24, 0x1B)       # Deep Field To Forest green-charcoal
BRAND_TEAL = RGBColor(0x14, 0x36, 0x28)
ACCENT_BLUE = RGBColor(0x03, 0x69, 0xA1)
SLATE = RGBColor(0x33, 0x41, 0x55)
MUTED = RGBColor(0x64, 0x74, 0x8B)
GREEN = RGBColor(0x16, 0x65, 0x34)
AMBER = RGBColor(0x92, 0x40, 0x0E)
RED = RGBColor(0x99, 0x1B, 0x1B)


def configure_document_styles(doc: Document) -> None:
    """Configure Normal and native Heading 1–3 styles plus automatic TOC field updates on open."""
    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(9.8)
    normal.font.color.rgb = SLATE
    normal.paragraph_format.space_after = Pt(5)
    normal.paragraph_format.line_spacing = 1.12

    h1 = doc.styles["Heading 1"]
    h1.font.name = "Calibri"
    h1.font.size = Pt(14)
    h1.font.bold = True
    h1.font.color.rgb = NAVY
    h1.paragraph_format.space_before = Pt(14)
    h1.paragraph_format.space_after = Pt(5)
    h1.paragraph_format.keep_with_next = True

    h2 = doc.styles["Heading 2"]
    h2.font.name = "Calibri"
    h2.font.size = Pt(11.5)
    h2.font.bold = True
    h2.font.color.rgb = NAVY
    h2.paragraph_format.space_before = Pt(10)
    h2.paragraph_format.space_after = Pt(4)
    h2.paragraph_format.keep_with_next = True

    h3 = doc.styles["Heading 3"]
    h3.font.name = "Calibri"
    h3.font.size = Pt(10.3)
    h3.font.bold = True
    h3.font.color.rgb = ACCENT_BLUE
    h3.paragraph_format.space_before = Pt(8)
    h3.paragraph_format.space_after = Pt(3)
    h3.paragraph_format.keep_with_next = True

    # Instruct Word / LibreOffice to auto-update TOC & PAGE/NUMPAGES fields on open
    settings = doc.settings.element
    if settings.find(qn("w:updateFields")) is None:
        uf = OxmlElement("w:updateFields")
        uf.set(qn("w:val"), "true")
        settings.append(uf)


def shade_cell(cell, hex_fill: str) -> None:
    shading = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{hex_fill}"/>')
    cell._tc.get_or_add_tcPr().append(shading)


def _set_table_cell_margins(table, top: int = 65, bottom: int = 65, left: int = 105, right: int = 105) -> None:
    tbl_pr = table._tbl.tblPr
    tc_mar = parse_xml(
        f'<w:tblCellMar {nsdecls("w")}>'
        f'<w:top w:w="{top}" w:type="dxa"/>'
        f'<w:left w:w="{left}" w:type="dxa"/>'
        f'<w:bottom w:w="{bottom}" w:type="dxa"/>'
        f'<w:right w:w="{right}" w:type="dxa"/>'
        f"</w:tblCellMar>"
    )
    tbl_pr.append(tc_mar)


def set_table_borders(table, color: str = "CBD5E1") -> None:
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
    _set_table_cell_margins(table)


def _mark_row_cant_split(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    tr_pr.append(OxmlElement("w:cantSplit"))


def _mark_row_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    tr_pr.append(OxmlElement("w:tblHeader"))


def add_heading(doc: Document, text: str, level: int = 1) -> None:
    """Add a true Word Heading 1/2/3 paragraph so Navigation Pane, PDF bookmarks & live TOC work."""
    style_name = f"Heading {min(3, max(1, level))}"
    p = doc.add_paragraph(style=style_name)
    p.paragraph_format.keep_with_next = True
    run = p.add_run(text)
    run.bold = True
    run.font.name = "Calibri"
    run.font.size = Pt(14 if level == 1 else (11.5 if level == 2 else 10.3))
    run.font.color.rgb = NAVY if level <= 2 else ACCENT_BLUE
    if level == 1:
        pPr = p._p.get_or_add_pPr()
        pBdr = parse_xml(
            f'<w:pBdr {nsdecls("w")}><w:bottom w:val="single" w:sz="8" w:space="3" w:color="143628"/></w:pBdr>'
        )
        pPr.append(pBdr)


def add_dynamic_toc_field(doc: Document) -> None:
    """Insert a native Microsoft Word Table of Contents field (auto-populates page numbers on open)."""
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(6)

    run_begin = p.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    run_begin._r.append(fld_begin)

    run_instr = p.add_run()
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = ' TOC \\o "1-2" \\h \\z \\u '
    run_instr._r.append(instr)

    run_sep = p.add_run()
    fld_sep = OxmlElement("w:fldChar")
    fld_sep.set(qn("w:fldCharType"), "separate")
    run_sep._r.append(fld_sep)

    run_hint = p.add_run(
        "Automatic Table of Contents — Right-click and choose 'Update Field' (or open in Word/LibreOffice) to refresh exact page numbers."
    )
    run_hint.italic = True
    run_hint.font.size = Pt(8.6)
    run_hint.font.color.rgb = MUTED

    run_end = p.add_run()
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    run_end._r.append(fld_end)


def add_callout(doc: Document, title: str, body: str, fill_hex: str = "F0FDF4", border_hex: str = "166534") -> None:
    tbl = doc.add_table(rows=1, cols=1)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    _set_table_cell_margins(tbl, top=80, bottom=80, left=130, right=120)
    _mark_row_cant_split(tbl.rows[0])
    cell = tbl.rows[0].cells[0]
    cell.width = Inches(6.7)
    shade_cell(cell, fill_hex)
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
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    rt = p.add_run(f"{title}: ")
    rt.bold = True
    rt.font.size = Pt(9.4)
    rt.font.color.rgb = NAVY
    rb = p.add_run(body)
    rb.font.size = Pt(9.4)
    rb.font.color.rgb = SLATE


def add_kv_table(doc: Document, rows: list[tuple[str, str]], col_widths=(2.35, 4.35)) -> None:
    tbl = doc.add_table(rows=len(rows), cols=2)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_borders(tbl)
    for idx, (k, v) in enumerate(rows):
        row = tbl.rows[idx]
        _mark_row_cant_split(row)
        c0, c1 = row.cells[0], row.cells[1]
        c0.width = Inches(col_widths[0])
        c1.width = Inches(col_widths[1])
        shade_cell(c0, "F1F5F9")
        p0 = c0.paragraphs[0]
        p0.paragraph_format.space_before = Pt(2)
        p0.paragraph_format.space_after = Pt(2)
        r0 = p0.add_run(k)
        r0.bold = True
        r0.font.size = Pt(9.2)
        r0.font.color.rgb = NAVY

        p1 = c1.paragraphs[0]
        p1.paragraph_format.space_before = Pt(2)
        p1.paragraph_format.space_after = Pt(2)
        r1 = p1.add_run(v)
        r1.font.size = Pt(9.2)
        r1.font.color.rgb = SLATE


def add_grid_table(
    doc: Document,
    headers: list[str],
    rows: list[list[str]],
    status_col: int | None = None,
) -> None:
    tbl = doc.add_table(rows=len(rows) + 1, cols=len(headers))
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_borders(tbl)

    hdr_row = tbl.rows[0]
    _mark_row_header(hdr_row)
    _mark_row_cant_split(hdr_row)
    for j, h in enumerate(headers):
        cell = hdr_row.cells[j]
        shade_cell(cell, "143628")
        p = cell.paragraphs[0]
        p.paragraph_format.space_before = Pt(3)
        p.paragraph_format.space_after = Pt(3)
        r = p.add_run(h)
        r.bold = True
        r.font.size = Pt(8.7)
        r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)

    for i, rdata in enumerate(rows):
        row = tbl.rows[i + 1]
        _mark_row_cant_split(row)
        bg = "FFFFFF" if i % 2 == 0 else "F8FAFC"
        for j, val in enumerate(rdata):
            cell = row.cells[j]
            shade_cell(cell, bg)
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(2)
            r = p.add_run(str(val))
            r.font.size = Pt(8.5)
            if status_col is not None and j == status_col:
                r.bold = True
                u = str(val).upper()
                if u in ("PASS", "✓", "NO LIMITATION", "NO LIMITATIONS", "COMPLIANT", "SATISFIED", "READY"):
                    r.font.color.rgb = GREEN
                    shade_cell(cell, "DCFCE7")
                elif u in ("LIMITATION", "×", "INFO", "MITIGATED", "CONDITIONAL", "TRIGGERED", "PENDING"):
                    r.font.color.rgb = AMBER
                    shade_cell(cell, "FEF3C7")
                elif u in ("FAIL", "NON-COMPLIANT"):
                    r.font.color.rgb = RED
                    shade_cell(cell, "FEE2E2")
            else:
                r.font.color.rgb = SLATE


def add_bullet(doc: Document, text: str, bold_prefix: str | None = None) -> None:
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


def add_figure(doc: Document, img_path: Path | None, caption: str, width_in: float = 6.5) -> bool:
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


def add_photo_grid(doc: Document, valid_photos: list[tuple[Path, str]]) -> None:
    """Render site inspection photographs in a clean 2-up framed grid with non-splitting rows."""
    if not valid_photos:
        return
    n_rows = (len(valid_photos) + 1) // 2
    tbl = doc.add_table(rows=n_rows, cols=2)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_borders(tbl, color="E2E8F0")

    for idx, (ppath, caption) in enumerate(valid_photos):
        r_idx = idx // 2
        c_idx = idx % 2
        row = tbl.rows[r_idx]
        _mark_row_cant_split(row)
        cell = row.cells[c_idx]
        cell.width = Inches(3.35)
        shade_cell(cell, "FFFFFF")

        p_img = cell.paragraphs[0]
        p_img.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_img.paragraph_format.space_before = Pt(3)
        p_img.paragraph_format.space_after = Pt(3)
        p_img.add_run().add_picture(str(ppath), width=Inches(3.05))

        p_cap = cell.add_paragraph()
        p_cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_cap.paragraph_format.space_before = Pt(0)
        p_cap.paragraph_format.space_after = Pt(3)
        r_num = p_cap.add_run(f"Photo {idx + 1}: ")
        r_num.bold = True
        r_num.font.size = Pt(8.3)
        r_num.font.color.rgb = NAVY
        r_cap = p_cap.add_run(caption)
        r_cap.italic = True
        r_cap.font.size = Pt(8.3)
        r_cap.font.color.rgb = SLATE

    # Leave trailing empty cell cleanly shaded if odd photo count
    if len(valid_photos) % 2 == 1:
        empty_cell = tbl.rows[-1].cells[1]
        empty_cell.width = Inches(3.35)
        shade_cell(empty_cell, "F8FAFC")


def configure_header_footer(
    section,
    header_left: str,
    header_right: str,
    footer_left: str,
) -> None:
    """Suppress header/footer on Cover Page (Page 1) and add crisp running header & page X of Y footer on body pages."""
    section.different_first_page_header_footer = True

    # Running body header
    hdr = section.header
    hp = hdr.paragraphs[0]
    hp.alignment = WD_ALIGN_PARAGRAPH.LEFT
    hp.paragraph_format.space_after = Pt(4)
    pPr = hp._p.get_or_add_pPr()
    pPr.append(
        parse_xml(f'<w:pBdr {nsdecls("w")}><w:bottom w:val="single" w:sz="4" w:space="2" w:color="CBD5E1"/></w:pBdr>')
    )
    hr1 = hp.add_run(header_left)
    hr1.bold = True
    hr1.font.size = Pt(8)
    hr1.font.color.rgb = NAVY
    hr2 = hp.add_run(f"   |   {header_right}")
    hr2.font.size = Pt(8)
    hr2.font.color.rgb = MUTED

    # Running body footer with dynamic PAGE of NUMPAGES
    footer = section.footer
    fp = footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.LEFT
    fp.paragraph_format.space_before = Pt(4)
    fpPr = fp._p.get_or_add_pPr()
    fpPr.append(
        parse_xml(f'<w:pBdr {nsdecls("w")}><w:top w:val="single" w:sz="4" w:space="2" w:color="CBD5E1"/></w:pBdr>')
    )
    r1 = fp.add_run(f"{footer_left}   |   Page ")
    r1.font.size = Pt(8)
    r1.font.color.rgb = MUTED

    fld_page = OxmlElement("w:fldSimple")
    fld_page.set(qn("w:instr"), "PAGE")
    fp._p.append(fld_page)

    r2 = fp.add_run(" of ")
    r2.font.size = Pt(8)
    r2.font.color.rgb = MUTED

    fld_numpages = OxmlElement("w:fldSimple")
    fld_numpages.set(qn("w:instr"), "NUMPAGES")
    fp._p.append(fld_numpages)


def add_document_control_table(
    doc: Document,
    project_ref: str,
    assessment_date_str: str,
    author_name: str,
    is_final_ready: bool,
    readiness_note: str,
) -> None:
    """Insert a standard engineering Document Control & Revision History table."""
    status_label = "FINAL — READY FOR LODGEMENT" if is_final_ready else "DRAFT — PRE-LODGEMENT REVIEW"
    add_heading(doc, "Document Control & Revision History", level=2)
    add_grid_table(
        doc,
        ["Revision", "Date", "Prepared By", "QA / Readiness Notes", "Document Status"],
        [
            [
                "Rev 1.0",
                assessment_date_str,
                author_name,
                readiness_note,
                "READY" if is_final_ready else "PENDING",
            ]
        ],
        status_col=4,
    )
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(3)
    p.paragraph_format.space_after = Pt(6)
    r = p.add_run(f"Controlled Reference: {project_ref}  ·  Issue Classification: {status_label}")
    r.italic = True
    r.font.size = Pt(8.3)
    r.font.color.rgb = MUTED
