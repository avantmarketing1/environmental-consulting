import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

// Provide local-disk fetch for Node test execution
globalThis.fetch = async (url) => {
  const rel = String(url).replace(/^\/consulting\//, "");
  const full = path.join(appRoot, "public", "consulting", rel);
  const text = fs.readFileSync(full, "utf-8");
  return { ok: true, json: async () => JSON.parse(text), text: async () => text };
};

const { loadLismoreDatasets, runLismoreModelJS, auditLismoreComplianceJS, renderCadLayoutSvg } = await import(
  "../public/consulting/app/lismore-engine.js"
);
const {
  renderTreatmentTrainSvg,
  renderSepticCrossSectionSvg,
  renderReedBedCrossSectionSvg,
  renderEtaCrossSectionSvg,
  renderSdiCrossSectionSvg,
  renderGisSiteMapSvg,
  renderGreaseArrestorCrossSectionSvg,
} = await import("../public/consulting/app/diagrams.js");

const { rules, climate } = await loadLismoreDatasets();
assert.equal(climate.n, 7670, "Expected 7,670 Alstonville climate days");
assert.equal(Object.keys(rules.morand_soil_units).length, 27, "Expected all 27 Lismore Morand soil units");

// 1) Test Synthetic 1-BR Rural Secondary Reed Bed + ETA Case (exact 240 L/d parity check)
const sc = {
  project_ref: "FTF-TEST-001",
  applicant_name: "Sample Client",
  site_address: "100 Sample Creek Rd, Lismore NSW 2480",
  lot_number: "1",
  plan_label: "DP100000",
  lga: "Lismore City Council",
  block_size_m2: 10000,
  bedrooms: 1,
  water_supply: "roof_full_water_saving",
  wastewater_components: { toilet: true, bathroom: true, laundry: true, kitchen: true },
  treatment_system: "secondary_reed_bed",
  land_application_type: "eta_beds",
  buffer_feature: "gully",
  buffer_distance_m: 45,
  morand_code: "co",
  soil_texture_id: 9,
  reed_bed_wetted_depth_m: 0.7,
  root_zone_depth_mm: 300,
  gravel_depth_mm: 300,
  trench_width_m: 2.0,
  trench_separation_m: 2.0,
  site_eval: {
    assessment_date: "2026-11-22",
    slope_pct: 7.0,
    aspect: "North-East",
    exposure: "high",
    landform: "linear_planar",
    depth_to_water_table_m: 3.0,
    dist_gully_m: 45,
    dist_perennial_watercourse_m: 150,
    dist_property_boundary_m: 25,
    septic_to_dwelling_m: 4.5,
    reserve_laa_available: true,
  },
  boreholes: [
    { borehole_id: "BH1", horizons: [{ horizon: "B", depth_top_mm: 150, depth_bottom_mm: 1000, ph: 6.0, dispersive_class: 3 }] },
    { borehole_id: "BH2", horizons: [{ horizon: "B", depth_top_mm: 150, depth_bottom_mm: 1000, ph: 6.0, dispersive_class: 3 }] },
  ],
};
const t0 = performance.now();
const scRes = runLismoreModelJS(sc, rules, climate);
const ms = performance.now() - t0;

assert.equal(scRes.total_flow_ld, 240);
assert.equal(scRes.hydraulic_area_m2, 22.5);
assert.equal(scRes.nitrogen_area_m2, 0.0);
assert.equal(scRes.phosphorus_area_m2, 20.0);
assert.equal(scRes.required_laa_m2, 22.5);
assert.equal(scRes.reed_bed_required_m2, 5.6);
assert.equal(scRes.reed_bed_hrt_days, 6.5);
assert.equal(scRes.n_removal_pct, 68.0);
assert.equal(scRes.trench_layout.trench_length_m, 11.2);

const scAudit = auditLismoreComplianceJS(sc, { drinking_water_catchment: false, flood_planning: false }, scRes, rules);
assert.equal(scAudit.requires_gypsum, true);
assert.equal(scAudit.departures_from_strategy.length, 0);

const svg = renderCadLayoutSvg(sc, scRes);
assert.ok(svg.includes("ETA BED 1: 11.2 m"), "SVG layout should include exact ETA dimensions");

// 2) Test LCC Excel Workbook Default Case (600 L/d AWTS)
const wbDef = {
  project_ref: "DEFAULT",
  applicant_name: "Default",
  site_address: "Test",
  lot_number: "1",
  plan_label: "DP100000",
  block_size_m2: 2000,
  bedrooms: 3,
  water_supply: "reticulated_full_water_saving",
  wastewater_components: { toilet: true, bathroom: true, laundry: true, kitchen: true },
  treatment_system: "secondary_awts",
  land_application_type: "eta_beds",
  buffer_feature: "gully",
  buffer_distance_m: 40,
  morand_code: "ge",
  soil_texture_id: 9,
  root_zone_depth_mm: 150,
  gravel_depth_mm: 250,
  trench_width_m: 2.0,
  trench_separation_m: 2.0,
  site_eval: { depth_to_water_table_m: 3.0, slope_pct: 0 },
};
const defRes = runLismoreModelJS(wbDef, rules, climate);
assert.equal(defRes.hydraulic_area_m2, 55.3);
assert.equal(defRes.nitrogen_area_m2, 199.2);
assert.equal(defRes.phosphorus_area_m2, 33.5);
assert.equal(defRes.required_laa_m2, 199.2);
assert.equal(defRes.trench_layout.number_of_trenches, 5);
assert.equal(defRes.trench_layout.trench_length_m, 19.9);

// 3) Test 4-Bedroom SDI (Sub-Surface Drip Irrigation) -> Contiguous Zone (NOT 14 separated ETA beds!)
const sdi4 = {
  ...wbDef,
  block_size_m2: 10000,
  bedrooms: 4,
  water_supply: "roof_full_water_saving",
  treatment_system: "secondary_reed_bed",
  land_application_type: "subsurface_drip_irrigation",
  morand_code: "co",
  soil_texture_id: 9,
};
const sdiRes = runLismoreModelJS(sdi4, rules, climate);
assert.equal(sdiRes.required_laa_m2, 558.7);
assert.equal(sdiRes.trench_layout.number_of_trenches, 1);
assert.equal(sdiRes.trench_layout.trench_separation_m, 0);
assert.equal(sdiRes.trench_layout.envelope_area_m2, 558.7);
const sdiSvg = renderCadLayoutSvg(sdi4, sdiRes);
assert.ok(sdiSvg.includes("SUB-SURFACE DRIP IRRIGATION ZONE"), "SDI SVG should draw contiguous irrigation zone");
assert.ok(sdiSvg.includes("1800 L Pump Well"), "SDI SVG should include pump well");

// 4) Test 5-bed ETA SVG fits all 5 beds dynamically
const eta5Svg = renderCadLayoutSvg(wbDef, defRes);
assert.ok(eta5Svg.includes("ETA BED 5:"), "Dynamic ETA SVG must render all 5 beds without clipping");

// 5) Test all 6 engineering cross-section & GIS site map SVG renderers in diagrams.js
const ttSvg = renderTreatmentTrainSvg(sc, scRes);
assert.ok(ttSvg.includes("SECONDARY REED BED") && ttSvg.includes("ETA DISPOSAL FIELD"), "Treatment train SVG missing blocks");
const sepSvg = renderSepticCrossSectionSvg(scRes);
assert.ok(sepSvg.includes("3000 L BAFFLED SEPTIC TANK"), "Septic XSec SVG missing capacity");
const rbSvg = renderReedBedCrossSectionSvg(sc, scRes);
assert.ok(rbSvg.includes("Duraplas Deep Reed Bed Tub"), "Reed Bed XSec SVG missing model");
const etaXsecSvg = renderEtaCrossSectionSvg(sc, scRes, scAudit);
assert.ok(etaXsecSvg.includes("GYPSUM") || etaXsecSvg.includes("Gypsum"), "ETA XSec SVG should show gypsum amelioration for Class 3/4");
const sdiXsecSvg = renderSdiCrossSectionSvg(sdi4, sdiRes);
assert.ok(sdiXsecSvg.includes("558.7 m²") || sdiXsecSvg.includes("1,800 L"), "SDI XSec SVG missing key design details");
const gisSvg = renderGisSiteMapSvg(sc, {
  fetched_live: true,
  lot_id_string: "1//DP100000",
  parcel_area_ha: 8.46,
  centroid_easting_mga56: 520123,
  centroid_northing_mga56: 6838456,
  parcel_geojson: {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[[153.2, -28.58], [153.203, -28.58], [153.203, -28.583], [153.2, -28.583], [153.2, -28.58]]],
    },
  },
  watercourses_geojson: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [[153.199, -28.581], [153.204, -28.582]],
      },
    },
  ],
});
assert.ok(gisSvg.includes("OSSM-GIS-01") && gisSvg.includes("DP100000"), "GIS Site Map SVG missing title block / Lot DP");

// 5b) Test Multi-Use Agritourism + Food Processing (Grease Arrestor + Surge Tank + High-BOD Reed Bed)
const farmMix = {
  ...sc,
  development_category: "mixed_farm_development",
  grease_arrestor_required: true,
  wastewater_sources: [
    { label: "Primary Dwelling", source_type: "dwelling", units: 1, bedrooms_per_unit: 3 },
    { label: "Agritourism Cabins", source_type: "agritourism_cabin", units: 3, bedrooms_per_unit: 1, guests_per_unit: 2, peak_surge_factor: 1.2 },
    { label: "Food Processing Kitchen", source_type: "food_processing_commercial", units: 1, bedrooms_per_unit: 0, daily_flow_l_override: 450, influent_bod_mgl: 650, requires_grease_trap: true },
  ],
};
const mixRes = runLismoreModelJS(farmMix, rules, climate);
assert.equal(mixRes.source_breakdown.length, 3);
assert.ok(mixRes.grease_arrestor_min_l >= 1000, "Grease arrestor must be >= 1000 L");
assert.ok(mixRes.surge_tank_min_l >= 1500, "Surge balance tank must be auto-sized for agritourism/commercial");
assert.ok(mixRes.weighted_influent_bod_mgl > 300, "High-strength food processing must elevate weighted BOD");
const mixAudit = auditLismoreComplianceJS(farmMix, { drinking_water_catchment: false, flood_planning: false }, mixRes, rules);
assert.equal(mixAudit.requires_grease_arrestor, true);
const greaseSvg = renderGreaseArrestorCrossSectionSvg(mixRes);
assert.ok(greaseSvg.includes("COMMERCIAL GREASE ARRESTOR"), "Grease Arrestor SVG missing title");
const mixTtSvg = renderTreatmentTrainSvg(farmMix, mixRes);
assert.ok(mixTtSvg.includes("GREASE ARRESTOR") && mixTtSvg.includes("BALANCE TANK"), "Multi-use treatment train missing grease/balance blocks");

// 5c) Verify true-to-scale Reed Bed plan view & CAD layout (single tub + multi-tub series)
assert.equal(scRes.recommended_reed_bed_dims.length_m, 3.0);
assert.equal(scRes.recommended_reed_bed_dims.width_m, 1.9);
assert.ok(rbSvg.includes("PLAN SCALE:") && rbSvg.includes("3.0 m (3000 mm) LENGTH"), "Single-tub reed bed SVG missing scale bar / length dim");
const mixRbSvg = renderReedBedCrossSectionSvg(farmMix, mixRes);
assert.ok(mixRbSvg.includes("TUBS IN SERIES") && mixRbSvg.includes("TUB 2"), "Multi-tub reed bed SVG should render series tubs");
const mixCadSvg = renderCadLayoutSvg(farmMix, mixRes);
assert.ok(mixCadSvg.includes("SCALE BAR:") && mixCadSvg.includes("RB1") && mixCadSvg.includes("RB2"), "CAD layout should render scaled series reed bed tubs + scale bar");

// 6) Strict XML validity check (no HTML-only entities like &ge;, &nbsp; or unescaped '&')
// Ensures browser Image('image/svg+xml') rasterization NEVER silently fails!
const allSvgs = {
  cadEta: svg,
  cadSdi: sdiSvg,
  cadEta5: eta5Svg,
  cadMix: mixCadSvg,
  treatmentTrain: ttSvg,
  multiTreatmentTrain: mixTtSvg,
  greaseXsec: greaseSvg,
  septicXsec: sepSvg,
  reedBedXsec: rbSvg,
  reedBedSeriesXsec: mixRbSvg,
  etaXsec: etaXsecSvg,
  sdiXsec: sdiXsecSvg,
  gisMap: gisSvg,
};
for (const [name, content] of Object.entries(allSvgs)) {
  const noComments = content.replace(/<!--[\s\S]*?-->/g, "");
  const badEntity = noComments.match(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)[a-zA-Z0-9]+;/g);
  assert.equal(badEntity, null, `SVG '${name}' contains non-XML HTML entities: ${badEntity}`);
  const bareAmp = noComments.match(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g);
  assert.equal(bareAmp, null, `SVG '${name}' contains unescaped '&'`);
}

console.log(`[PASS] Browser JS Lismore OSmodel300614 + all 9 strict-XML SVG drawings verified in ${ms.toFixed(1)} ms!`);
