/**
 * Browser-Side Pyodide Web Worker (Zero Cloudflare Server CPU!).
 * Loads our exact Phase 1 Python modules (enviro_comply) + ezdxf + python-docx inside WebAssembly
 * to compile real council-ready .docx reports and 12-layer AutoCAD .dxf drawings locally or offline.
 */

let pyodide = null;
let readyPromise = null;

const PY_FILES = [
  "enviro_comply/__init__.py",
  "enviro_comply/data/alstonville_climate.json",
  "enviro_comply/data/lismore_rules.json",
  "enviro_comply/schemas/__init__.py",
  "enviro_comply/schemas/ossm.py",
  "enviro_comply/schemas/see.py",
  "enviro_comply/engine/__init__.py",
  "enviro_comply/engine/lismore_model.py",
  "enviro_comply/engine/compliance_rules.py",
  "enviro_comply/engine/see_rules.py",
  "enviro_comply/cad/__init__.py",
  "enviro_comply/cad/dxf_builder.py",
  "enviro_comply/report/__init__.py",
  "enviro_comply/report/docx_styles.py",
  "enviro_comply/report/docx_builder.py",
  "enviro_comply/report/see_docx_builder.py",
];

async function initPyodide() {
  if (pyodide) return pyodide;
  postMessage({ type: "status", message: "Loading Pyodide WebAssembly runtime..." });

  importScripts("https://cdn.jsdelivr.net/pyodide/v0.27.5/full/pyodide.js");
  pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.27.5/full/" });

  postMessage({ type: "status", message: "Loading NumPy, Pydantic, lxml & micropip..." });
  await pyodide.loadPackage(["numpy", "pydantic", "lxml", "pyparsing", "typing-extensions", "micropip"]);

  const micropip = pyodide.pyimport("micropip");
  postMessage({ type: "status", message: "Installing ezdxf & python-docx wheels in browser..." });
  await micropip.install(["ezdxf", "python-docx"]);

  postMessage({ type: "status", message: "Mounting Field To Forest Python engine modules..." });
  for (const rel of PY_FILES) {
    const resp = await fetch(`/consulting/py/${rel}?v=21`);
    if (!resp.ok) throw new Error(`Failed to fetch /consulting/py/${rel}`);
    const content = await resp.text();
    const parts = rel.split("/");
    let dir = "/home/pyodide";
    for (let i = 0; i < parts.length - 1; i++) {
      dir += "/" + parts[i];
      try { pyodide.FS.mkdir(dir); } catch (_) {}
    }
    pyodide.FS.writeFile(`/home/pyodide/${rel}`, content);
  }

  // Mount shared single-source-of-truth Python modules (including matplotlib-free cad.dxf_builder!)
  await pyodide.runPythonAsync(`
import sys, json
from pathlib import Path
sys.path.insert(0, "/home/pyodide")

from enviro_comply.schemas.ossm import SiteAssessmentInput, SpatialPreCheckResult
from enviro_comply.schemas.see import SEEAssessmentInput
from enviro_comply.engine.lismore_model import run_lismore_wastewater_model
from enviro_comply.engine.compliance_rules import audit_lismore_compliance
from enviro_comply.engine.see_rules import audit_lismore_see
from enviro_comply.cad.dxf_builder import build_ossm_dxf_bytes
from enviro_comply.report.docx_builder import build_ossm_docx_report
from enviro_comply.report.see_docx_builder import build_see_docx_report

def _to_bytes(val):
    if val is None:
        return None
    if isinstance(val, (bytes, bytearray)):
        return bytes(val)
    if hasattr(val, "to_bytes"):
        return val.to_bytes()
    return bytes(val)

def generate_council_package(
    assessment_json_str,
    spatial_json_str,
    cad_png_bytes=None,
    gis_png_bytes=None,
    diagrams_js=None,
    photos_js=None,
):
    inp = SiteAssessmentInput.model_validate_json(assessment_json_str)
    sp_raw = None
    if spatial_json_str:
        sp_raw = json.loads(spatial_json_str)
        spatial = SpatialPreCheckResult(
            lot_id_string=sp_raw.get("lot_id_string") or f"{inp.lot_number}//{inp.plan_label}",
            fetched_live=bool(sp_raw.get("fetched_live")),
            parcel_area_m2=sp_raw.get("parcel_area_m2"),
            parcel_area_ha=sp_raw.get("parcel_area_ha"),
            centroid_lat=sp_raw.get("centroid_lat"),
            centroid_lon=sp_raw.get("centroid_lon"),
            centroid_easting_mga56=sp_raw.get("centroid_easting_mga56"),
            centroid_northing_mga56=sp_raw.get("centroid_northing_mga56"),
            land_zoning=sp_raw.get("land_zoning") or [],
            min_lot_size=sp_raw.get("min_lot_size") or [],
            flood_planning=bool(sp_raw.get("flood_planning")),
            flood_details=sp_raw.get("flood_details") or [],
            landslide_risk=bool(sp_raw.get("landslide_risk")),
            acid_sulfate_soils=sp_raw.get("acid_sulfate_soils") or [],
            drinking_water_catchment=bool(sp_raw.get("drinking_water_catchment")),
            groundwater_vulnerability=bool(sp_raw.get("groundwater_vulnerability")),
            riparian_land=bool(sp_raw.get("riparian_land")),
            wetlands=bool(sp_raw.get("wetlands")),
            terrestrial_biodiversity=bool(sp_raw.get("terrestrial_biodiversity")),
            bushfire_prone_land=sp_raw.get("bushfire_prone_land") or [],
            nearest_watercourse_m=sp_raw.get("nearest_watercourse_m"),
            pre_site_flags=sp_raw.get("pre_site_flags") or [],
        )
    else:
        spatial = SpatialPreCheckResult(lot_id_string=f"{inp.lot_number}//{inp.plan_label}")

    model = run_lismore_wastewater_model(inp)
    audit = audit_lismore_compliance(inp, spatial, model)
    dxf_bytes = build_ossm_dxf_bytes(inp, model, spatial_data=sp_raw)

    cad_png_path = None
    b_cad = _to_bytes(cad_png_bytes)
    if b_cad:
        cad_png_path = Path("/tmp/cad_preview.png")
        cad_png_path.write_bytes(b_cad)

    gis_png_path = None
    b_gis = _to_bytes(gis_png_bytes)
    if b_gis:
        gis_png_path = Path("/tmp/gis_site_map.png")
        gis_png_path.write_bytes(b_gis)

    diag_paths = {}
    if diagrams_js is not None:
        diag_dict = diagrams_js.to_py() if hasattr(diagrams_js, "to_py") else dict(diagrams_js)
        for k, raw_b in diag_dict.items():
            b_d = _to_bytes(raw_b)
            if b_d:
                p = Path(f"/tmp/diag_{k}.png")
                p.write_bytes(b_d)
                diag_paths[k] = p

    photo_items = []
    if photos_js is not None:
        ph_list = photos_js.to_py() if hasattr(photos_js, "to_py") else list(photos_js)
        for idx, item in enumerate(ph_list):
            b_p = _to_bytes(item.get("bytes"))
            if b_p:
                ext = str(item.get("ext") or "jpg").lstrip(".").lower()
                if ext not in ("jpg", "jpeg", "png", "bmp", "gif", "tiff"):
                    ext = "jpg"
                p = Path(f"/tmp/site_photo_{idx}.{ext}")
                p.write_bytes(b_p)
                photo_items.append((p, str(item.get("caption") or f"Site Photo {idx + 1}")))

    docx_path = Path("/tmp/ossm_report.docx")
    build_ossm_docx_report(
        inp,
        spatial,
        model,
        audit,
        docx_path,
        gis_map_png=gis_png_path,
        cad_plan_png=cad_png_path,
        diagrams=diag_paths,
        photo_items=photo_items,
    )
    docx_bytes = docx_path.read_bytes()

    return {
        "model_json": model.model_dump_json(),
        "audit_json": audit.model_dump_json(),
        "docx_bytes": docx_bytes,
        "dxf_bytes": dxf_bytes,
        "embedded_count": int(bool(cad_png_path)) + int(bool(gis_png_path)) + len(diag_paths) + len(photo_items),
    }

def generate_see_package(
    see_json_str,
    spatial_json_str,
    gis_png_bytes=None,
    pin_map_png_bytes=None,
    field_pins_json_str="",
    photos_js=None,
):
    inp = SEEAssessmentInput.model_validate_json(see_json_str)
    if spatial_json_str:
        sp_raw = json.loads(spatial_json_str)
        spatial = SpatialPreCheckResult(
            lot_id_string=sp_raw.get("lot_id_string") or f"{inp.lot_number}//{inp.plan_label}",
            fetched_live=bool(sp_raw.get("fetched_live")),
            parcel_area_m2=sp_raw.get("parcel_area_m2"),
            parcel_area_ha=sp_raw.get("parcel_area_ha"),
            centroid_lat=sp_raw.get("centroid_lat"),
            centroid_lon=sp_raw.get("centroid_lon"),
            centroid_easting_mga56=sp_raw.get("centroid_easting_mga56"),
            centroid_northing_mga56=sp_raw.get("centroid_northing_mga56"),
            land_zoning=sp_raw.get("land_zoning") or [],
            min_lot_size=sp_raw.get("min_lot_size") or [],
            flood_planning=bool(sp_raw.get("flood_planning")),
            flood_details=sp_raw.get("flood_details") or [],
            landslide_risk=bool(sp_raw.get("landslide_risk")),
            acid_sulfate_soils=sp_raw.get("acid_sulfate_soils") or [],
            drinking_water_catchment=bool(sp_raw.get("drinking_water_catchment")),
            groundwater_vulnerability=bool(sp_raw.get("groundwater_vulnerability")),
            riparian_land=bool(sp_raw.get("riparian_land")),
            wetlands=bool(sp_raw.get("wetlands")),
            terrestrial_biodiversity=bool(sp_raw.get("terrestrial_biodiversity")),
            bushfire_prone_land=sp_raw.get("bushfire_prone_land") or [],
            nearest_watercourse_m=sp_raw.get("nearest_watercourse_m"),
            pre_site_flags=sp_raw.get("pre_site_flags") or [],
        )
    else:
        spatial = SpatialPreCheckResult(lot_id_string=f"{inp.lot_number}//{inp.plan_label}")

    audit = audit_lismore_see(inp, spatial)

    gis_png_path = None
    b_gis = _to_bytes(gis_png_bytes)
    if b_gis:
        gis_png_path = Path("/tmp/see_gis_map.png")
        gis_png_path.write_bytes(b_gis)

    pin_map_path = None
    b_pin = _to_bytes(pin_map_png_bytes)
    if b_pin:
        pin_map_path = Path("/tmp/see_pin_map.png")
        pin_map_path.write_bytes(b_pin)

    field_pins = json.loads(field_pins_json_str) if field_pins_json_str else []

    photo_items = []
    if photos_js is not None:
        ph_list = photos_js.to_py() if hasattr(photos_js, "to_py") else list(photos_js)
        for idx, item in enumerate(ph_list):
            b_p = _to_bytes(item.get("bytes"))
            if b_p:
                ext = str(item.get("ext") or "jpg").lstrip(".").lower()
                if ext not in ("jpg", "jpeg", "png", "bmp", "gif", "tiff"):
                    ext = "jpg"
                p = Path(f"/tmp/see_photo_{idx}.{ext}")
                p.write_bytes(b_p)
                photo_items.append((p, str(item.get("caption") or f"Site Photo {idx + 1}")))

    docx_path = Path("/tmp/lismore_see_report.docx")
    build_see_docx_report(
        inp,
        spatial,
        audit,
        docx_path,
        gis_map_png=gis_png_path,
        pin_map_png=pin_map_path,
        field_pins=field_pins,
        photo_items=photo_items,
    )
    docx_bytes = docx_path.read_bytes()

    return {
        "audit_json": audit.model_dump_json(),
        "docx_bytes": docx_bytes,
        "embedded_count": int(bool(gis_png_path)) + int(bool(pin_map_path)) + len(photo_items),
    }
`);

  postMessage({ type: "ready" });
  return pyodide;
}

self.onmessage = async (event) => {
  const { id, action, payload } = event.data;
  try {
    if (!readyPromise) readyPromise = initPyodide();
    const py = await readyPromise;

    if (action === "warmup") {
      postMessage({ id, ok: true, result: { ready: true } });
      return;
    }

    if (action === "generate") {
      postMessage({ type: "status", message: "Running Python OSmodel300614 + ezdxf + python-docx (with GIS Map, Cross-Sections & Photos)..." });
      const fn = py.globals.get("generate_council_package");
      const diagMap = {};
      if (payload.diagrams) {
        for (const [k, buf] of Object.entries(payload.diagrams)) {
          if (buf) diagMap[k] = new Uint8Array(buf);
        }
      }
      const photoList = (payload.photos || []).map((ph) => ({
        caption: ph.caption || "Site photo",
        ext: ph.ext || "jpg",
        bytes: ph.bytes ? new Uint8Array(ph.bytes) : null,
      }));

      const resProxy = fn(
        JSON.stringify(payload.assessment),
        payload.spatial ? JSON.stringify(payload.spatial) : "",
        payload.cadPngBytes ? new Uint8Array(payload.cadPngBytes) : null,
        payload.gisPngBytes ? new Uint8Array(payload.gisPngBytes) : null,
        diagMap,
        photoList,
      );
      const docxBytes = resProxy.get("docx_bytes").toJs();
      const dxfBytes = resProxy.get("dxf_bytes").toJs();
      const modelJson = resProxy.get("model_json");
      const auditJson = resProxy.get("audit_json");
      const embeddedCount = resProxy.get("embedded_count");
      resProxy.destroy();

      postMessage(
        {
          id,
          ok: true,
          result: {
            model: JSON.parse(modelJson),
            audit: JSON.parse(auditJson),
            docxBuffer: docxBytes.buffer,
            dxfBuffer: dxfBytes.buffer,
            embeddedCount,
          },
        },
        [docxBytes.buffer, dxfBytes.buffer],
      );
    }

    if (action === "generate_see") {
      postMessage({ type: "status", message: "Compiling Lismore City Council Statement of Environmental Effects (.docx)..." });
      const fn = py.globals.get("generate_see_package");
      const photoList = (payload.photos || []).map((ph) => ({
        caption: ph.caption || "Site photo",
        ext: ph.ext || "jpg",
        bytes: ph.bytes ? new Uint8Array(ph.bytes) : null,
      }));
      const resProxy = fn(
        JSON.stringify(payload.seeInput),
        payload.spatial ? JSON.stringify(payload.spatial) : "",
        payload.gisPngBytes ? new Uint8Array(payload.gisPngBytes) : null,
        payload.pinMapPngBytes ? new Uint8Array(payload.pinMapPngBytes) : null,
        payload.fieldPins ? JSON.stringify(payload.fieldPins) : "",
        photoList,
      );
      const docxBytes = resProxy.get("docx_bytes").toJs();
      const auditJson = resProxy.get("audit_json");
      const embeddedCount = resProxy.get("embedded_count");
      resProxy.destroy();

      postMessage(
        {
          id,
          ok: true,
          result: {
            audit: JSON.parse(auditJson),
            docxBuffer: docxBytes.buffer,
            embeddedCount,
          },
        },
        [docxBytes.buffer],
      );
    }
  } catch (err) {
    postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
