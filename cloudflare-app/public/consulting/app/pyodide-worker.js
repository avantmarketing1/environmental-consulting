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
  "enviro_comply/report/__init__.py",
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
    const resp = await fetch(`/consulting/py/${rel}`);
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

  // Register lightweight pure-ezdxf DXF generator (no matplotlib needed inside browser Pyodide!)
  await pyodide.runPythonAsync(`
import sys, json
from pathlib import Path
sys.path.insert(0, "/home/pyodide")

import ezdxf
from enviro_comply.schemas.ossm import SiteAssessmentInput, SpatialPreCheckResult, TreatmentSystemType
from enviro_comply.schemas.see import SEEAssessmentInput
from enviro_comply.engine.lismore_model import run_lismore_wastewater_model
from enviro_comply.engine.compliance_rules import audit_lismore_compliance
from enviro_comply.engine.see_rules import audit_lismore_see
from enviro_comply.report.docx_builder import build_ossm_docx_report
from enviro_comply.report.see_docx_builder import build_see_docx_report

def _add_rect_dxf(msp, cx, cy, w, h, layer, hatch_pattern=None):
    x0, y0 = cx - w / 2.0, cy - h / 2.0
    pts = [(x0, y0), (x0 + w, y0), (x0 + w, y0 + h), (x0, y0 + h), (x0, y0)]
    msp.add_lwpolyline(pts, dxfattribs={"layer": layer})
    if hatch_pattern:
        hatch = msp.add_hatch(dxfattribs={"layer": layer})
        hatch.set_pattern_fill(hatch_pattern, scale=0.4)
        hatch.paths.add_polyline_path(pts[:-1], is_closed=True)

def build_dxf_bytes(inp, model):
    tr = model.trench_layout
    has_rb = inp.treatment_system == TreatmentSystemType.SECONDARY_REED_BED
    is_irrig = inp.land_application_type.value != "eta_beds"
    dw_x, dw_y, dw_w, dw_l = 0.0, 12.0, 10.0, 6.0
    st_x, st_y, st_r = 0.0, 4.5, 1.0
    rb_x, rb_y, rb_w, rb_l = 0.0, 0.5, 1.9, 3.0 * max(1, model.recommended_reed_bed_count)
    eta_x, eta_y = 0.0, (-5.0 if has_rb else -2.5)

    doc = ezdxf.new("R2010")
    doc.units = ezdxf.units.M
    msp = doc.modelspace()
    if "DASHED" not in doc.linetypes:
        doc.linetypes.add("DASHED", pattern=[0.6, 0.4, -0.2])
    for name, color, ltype in [
        ("1_DWELLING", 7, "CONTINUOUS"), ("2_SEPTIC_TANK", 30, "CONTINUOUS"),
        ("3_REED_BED", 3, "CONTINUOUS"), ("4_ETA_BED", 5, "CONTINUOUS"),
        ("5_RESERVE_LAA", 4, "DASHED"), ("6_PIPES", 1, "CONTINUOUS"),
        ("7_SETBACKS", 2, "DASHED"), ("8_DIVERSION_SWALE", 140, "CONTINUOUS"),
        ("9_BOREHOLES", 6, "CONTINUOUS"), ("10_VEGETATION", 94, "CONTINUOUS"),
        ("11_ANNOTATIONS", 7, "CONTINUOUS"), ("12_TITLE_BLOCK", 7, "CONTINUOUS"),
    ]:
        doc.layers.add(name, color=color, linetype=ltype)

    _add_rect_dxf(msp, dw_x, dw_y, dw_w, dw_l, "1_DWELLING", "ANSI31")
    _add_rect_dxf(msp, dw_x, dw_y, dw_w + 6.0, dw_l + 6.0, "7_SETBACKS")
    msp.add_text("DWELLING", dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.45}).set_placement((dw_x, dw_y), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)

    msp.add_circle((st_x, st_y), radius=st_r, dxfattribs={"layer": "2_SEPTIC_TANK"})
    msp.add_line((st_x - st_r, st_y), (st_x + st_r, st_y), dxfattribs={"layer": "2_SEPTIC_TANK"})
    msp.add_line((dw_x, dw_y - dw_l/2), (st_x, st_y + st_r), dxfattribs={"layer": "6_PIPES"})
    msp.add_text(f"{model.septic_tank_min_l}L SEPTIC TANK + FILTER", dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.35}).set_placement((st_x + 1.5, st_y), align=ezdxf.enums.TextEntityAlignment.MIDDLE_LEFT)

    if has_rb:
        _add_rect_dxf(msp, rb_x, rb_y, rb_w, rb_l, "3_REED_BED", "GRAVEL")
        msp.add_line((st_x, st_y - st_r), (rb_x, rb_y + rb_l/2), dxfattribs={"layer": "6_PIPES"})
        msp.add_text(f"{model.recommended_reed_bed_count}x REED BED ({model.recommended_reed_bed_provided_m2}m2)", dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.35}).set_placement((rb_x + 1.5, rb_y), align=ezdxf.enums.TextEntityAlignment.MIDDLE_LEFT)
        feed_from = (rb_x, rb_y - rb_l/2)
    else:
        feed_from = (st_x, st_y - st_r)

    trench_ys = []
    if is_irrig:
        zone_cy = eta_y - tr.trench_width_m / 2.0
        trench_ys.append(zone_cy)
        _add_rect_dxf(msp, eta_x, zone_cy, tr.trench_length_m, tr.trench_width_m, "4_ETA_BED", "ANSI37")
        msp.add_text(f"IRRIGATION ZONE: {tr.trench_length_m:.1f}m x {tr.trench_width_m:.1f}m ({model.required_laa_m2:.1f}m2)", dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.45}).set_placement((eta_x, zone_cy), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)
        msp.add_line(feed_from, (eta_x, eta_y), dxfattribs={"layer": "6_PIPES"})
    else:
        for i in range(tr.number_of_trenches):
            ty = eta_y - i * (tr.trench_width_m + tr.trench_separation_m)
            trench_ys.append(ty)
            _add_rect_dxf(msp, eta_x, ty, tr.trench_length_m, tr.trench_width_m, "4_ETA_BED", "ANSI37")
            msp.add_line((eta_x - tr.trench_length_m/2 + 0.5, ty), (eta_x + tr.trench_length_m/2 - 0.5, ty), dxfattribs={"layer": "6_PIPES"})
            msp.add_text(f"ETA BED {i+1}: {tr.trench_length_m:.1f}m x {tr.trench_width_m:.1f}m", dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.35}).set_placement((eta_x + tr.trench_length_m/2 + 0.6, ty), align=ezdxf.enums.TextEntityAlignment.MIDDLE_LEFT)
        msp.add_line(feed_from, (eta_x, trench_ys[0] + tr.trench_width_m/2), dxfattribs={"layer": "6_PIPES"})
    swale_y = trench_ys[0] + tr.trench_width_m/2 + 1.5
    sw_hw = tr.trench_length_m/2 + 2.0
    msp.add_lwpolyline([(eta_x - sw_hw, swale_y - 0.6), (eta_x - sw_hw + 1.2, swale_y), (eta_x + sw_hw - 1.2, swale_y), (eta_x + sw_hw, swale_y - 0.6)], dxfattribs={"layer": "8_DIVERSION_SWALE"})

    res_y = trench_ys[-1] - tr.trench_width_m/2 - 3.8 - tr.envelope_width_m/2
    _add_rect_dxf(msp, eta_x, res_y, tr.trench_length_m, tr.envelope_width_m, "5_RESERVE_LAA")
    msp.add_text(f"RESERVE LAA ({model.reserve_laa_m2:.1f}m2)", dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.35}).set_placement((eta_x, res_y), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)

    for idx, (bx, by) in enumerate([(eta_x - tr.trench_length_m/2 - 1.0, trench_ys[0]), (eta_x + tr.trench_length_m/2 + 1.0, trench_ys[-1])]):
        msp.add_circle((bx, by), radius=0.32, dxfattribs={"layer": "9_BOREHOLES"})
        msp.add_text(f"BH{idx+1}", dxfattribs={"layer": "11_ANNOTATIONS", "height": 0.30}).set_placement((bx + 0.4, by + 0.3))

    out_path = Path("/tmp/layout.dxf")
    doc.saveas(str(out_path))
    return out_path.read_bytes()

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
    dxf_bytes = build_dxf_bytes(inp, model)

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
    build_see_docx_report(inp, spatial, audit, docx_path, gis_map_png=gis_png_path, photo_items=photo_items)
    docx_bytes = docx_path.read_bytes()

    return {
        "audit_json": audit.model_dump_json(),
        "docx_bytes": docx_bytes,
        "embedded_count": int(bool(gis_png_path)) + len(photo_items),
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
