# EnviroComply — Lismore City Council OSSM Automation Engine

Deterministic **Field-to-Lodgement** compliance automation engine for **Lismore City Council (NSW) Section 68 On-Site Sewage Management (OSSM)** reports, GIS constraint maps, and AutoCAD `.dxf` layout plans.

## What Phase 1 Delivers

1. **Live NSW Spatial Services & Planning Portal Pre-Check (`spatial/nsw_arcgis.py`)**
   - Queries official NSW Cadastre (Lot/DP + neighbouring lots), Watercourses, Contours, EPI Land Zoning, Minimum Lot Size, Flood, Landslide, Acid Sulfate Soils, Drinking Water Catchment (Rous Water), Riparian/Wetlands/Biodiversity, and Bushfire Prone Land.
   - Reprojects cleanly into **GDA2020 / MGA Zone 56 (`EPSG:7856`)** for exact metric areas, slope, and buffer checks.
2. **Exact Deterministic Lismore Wastewater Engine (`engine/lismore_model.py`)**
   - Replicates every formula of Lismore City Council's official `OSmodel300614.xls` — including the **7,670-day Alstonville daily water balance (1970–1991)**, 95th-percentile exceedance solver, Headley & Davidson (2003) reed bed kinetics, Nitrogen percolation curve with buffer encroachment penalty, 50-year Phosphorus sorption balance across all **27 Morand (1994) soil units**, AS/NZS 1547 tank sizing, and Rectangular Trench Layout.
3. **Clause-Cited Compliance Auditor (`engine/compliance_rules.py`)**
   - Evaluates Lismore Strategy (2013) Tables 6 & 7, buffer setbacks, borehole depth/count, dispersive soil gypsum triggers, Rous Water catchment checks, and ETA bed geometry rules.
4. **Automated Deliverables (`spatial/map_renderer.py`, `cad/dxf_generator.py`, `report/docx_builder.py`)**
   - Print-ready **GDA2020 / MGA Zone 56 GIS Site Location & Buffer Map** (`PNG` + `PDF`)
   - Layered native **AutoCAD `.dxf` Engineering Layout Plan** + scaled `PNG`/`PDF` preview
   - Single-source-of-truth **Section 68 Microsoft Word (`.docx`) Report** with zero copy-paste drift

## Quickstart

```powershell
# Run deterministic unit & output tests
.venv\Scripts\python -m pytest -v

# Run a live NSW GIS Desktop Pre-Check for any Lismore Lot/DP
$env:PYTHONPATH="src"
.venv\Scripts\python -m enviro_comply.cli precheck --lot 5 --plan DP625836

# Generate complete Section 68 report, GIS map, and AutoCAD DXF for Stony Chute golden case
$env:PYTHONPATH="src"
.venv\Scripts\python -m enviro_comply.cli generate examples\stony_chute_lot5_dp625836.json --out outputs

# Launch FastAPI server (for Phase 2 Next.js Desktop Workbench & Offline Field PWA)
.venv\Scripts\python -m uvicorn enviro_comply.api:app --reload
```
