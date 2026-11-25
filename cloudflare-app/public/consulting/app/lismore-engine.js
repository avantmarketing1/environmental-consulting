/**
 * Instant Browser-Side Lismore City Council Daily Wastewater Model (OSmodel300614)
 * + Lismore Strategy (2013) Deterministic Compliance Auditor + Scaled SVG Layout Renderer.
 * Runs all 7,670 Alstonville climate days in < 5 ms with zero server CPU and 100% offline support.
 */

const DEG2RAD = Math.PI / 180;

/** Convert WGS84/GDA2020 (lon, lat) -> GDA2020 / MGA Zone 56 (EPSG:7856) Easting/Northing (metres). */
export function wgs84ToMga56(lon, lat) {
  const a = 6378137.0;
  const f = 1 / 298.257222101;
  const k0 = 0.9996;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);
  const lon0 = 153.0 * DEG2RAD;

  const phi = lat * DEG2RAD;
  const lam = lon * DEG2RAD;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);

  const N = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const T = tanPhi * tanPhi;
  const C = ep2 * cosPhi * cosPhi;
  const A = cosPhi * (lam - lon0);

  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 * e2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));

  const easting =
    500000 +
    k0 *
      N *
      (A +
        ((1 - T + C) * A ** 3) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120);

  const northing =
    10000000 +
    k0 *
      (M +
        N *
          tanPhi *
          ((A * A) / 2 +
            ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 +
            ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));

  return [Math.round(easting * 100) / 100, Math.round(northing * 100) / 100];
}

function pointToSegDistM(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-12) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Measure exact MGA56 distance (m) from a pin [easting, northing] to parcel boundary & mapped watercourses. */
export function computePinSetbacksMeters(pinMga, spatial) {
  if (!pinMga || !spatial) return { boundary_m: null, watercourse_m: null };
  const [px, py] = pinMga;

  let boundaryM = Infinity;
  const pg = spatial.parcel_geojson?.geometry;
  if (pg) {
    const rings = pg.type === "Polygon" ? [pg.coordinates[0]] : pg.type === "MultiPolygon" ? pg.coordinates.map((p) => p[0]) : [];
    for (const ring of rings) {
      if (!Array.isArray(ring) || ring.length < 2) continue;
      const mgaPts = ring.map(([lon, lat]) => wgs84ToMga56(lon, lat));
      for (let i = 0; i < mgaPts.length - 1; i++) {
        const d = pointToSegDistM(px, py, mgaPts[i][0], mgaPts[i][1], mgaPts[i + 1][0], mgaPts[i + 1][1]);
        if (d < boundaryM) boundaryM = d;
      }
    }
  }

  let waterM = Infinity;
  for (const wf of spatial.watercourses_geojson || []) {
    const g = wf?.geometry;
    if (!g) continue;
    const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
    for (const line of lines) {
      if (!Array.isArray(line) || line.length < 2) continue;
      const mgaPts = line.map(([lon, lat]) => wgs84ToMga56(lon, lat));
      for (let i = 0; i < mgaPts.length - 1; i++) {
        const d = pointToSegDistM(px, py, mgaPts[i][0], mgaPts[i][1], mgaPts[i + 1][0], mgaPts[i + 1][1]);
        if (d < waterM) waterM = d;
      }
    }
  }

  return {
    boundary_m: Number.isFinite(boundaryM) ? Math.round(boundaryM * 10) / 10 : null,
    watercourse_m: Number.isFinite(waterM) ? Math.round(waterM * 10) / 10 : null,
  };
}

let _climateCache = null;
let _rulesCache = null;

export async function loadLismoreDatasets() {
  if (!_rulesCache) {
    const r = await fetch("/consulting/data/lismore_rules.json");
    _rulesCache = await r.json();
  }
  if (!_climateCache) {
    const c = await fetch("/consulting/data/alstonville_climate.json");
    const raw = await c.json();
    const n = raw.evap_mm.length;
    const thru = new Float64Array(n);
    const et = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const rain = raw.rain_mm[i];
      thru[i] = rain > 0 ? rain - 4.0 * (1.0 - 1.0 / (1.0 + rain / 4.0)) : 0.0;
      et[i] = raw.evap_mm[i] * raw.crop_factor[i];
    }
    _climateCache = { n, thru, et };
  }
  return { rules: _rulesCache, climate: _climateCache };
}

function percentile95(arr) {
  const copy = Float64Array.from(arr);
  copy.sort();
  const idx = 0.95 * (copy.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return copy[lo] + (copy[hi] - copy[lo]) * (idx - lo);
}

function simulateDaily(areaM2, flowLd, bucketSat, bucketAwc, maxPerc, rbArea, climate) {
  const { n, thru, et } = climate;
  const irrig = flowLd / areaM2;
  const rbRatio = rbArea > 0 ? rbArea / areaM2 : 0;
  let endBal = bucketSat / 2.0;
  const exc = new Float64Array(n);
  let excCount = 0;

  for (let i = 1; i < n; i++) {
    const avail = endBal - bucketAwc;
    const perc = avail <= 0 ? 0 : avail < maxPerc ? avail : maxPerc;
    const netRE = thru[i] - et[i];
    const rbExtra = rbRatio > 0 ? rbRatio * netRE : 0;
    let bal = endBal + netRE + irrig + rbExtra - perc;
    if (bal < 0) bal = 0;
    if (bal > bucketSat) {
      exc[i] = bal - bucketSat;
      excCount++;
      endBal = bucketSat;
    } else {
      endBal = bal;
    }
  }
  return { p95: percentile95(exc), excCount };
}

function solveHydraulicArea(flowLd, bucketSat, bucketAwc, maxPerc, rbArea, climate) {
  let lo = 1.0;
  let hi = Math.max(50.0, (flowLd / Math.max(0.5, maxPerc)) * 4.0);
  while (simulateDaily(hi, flowLd, bucketSat, bucketAwc, maxPerc, rbArea, climate).p95 > 1e-9) {
    hi *= 2.0;
    if (hi > 50000) break;
  }
  for (let k = 0; k < 42; k++) {
    const mid = 0.5 * (lo + hi);
    if (simulateDaily(mid, flowLd, bucketSat, bucketAwc, maxPerc, rbArea, climate).p95 > 1e-9) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const finalSim = simulateDaily(hi, flowLd, bucketSat, bucketAwc, maxPerc, rbArea, climate);
  return { area: hi, p95: finalSim.p95, excCount: finalSim.excCount };
}

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;

export function runLismoreModelJS(inp, rules, climate) {
  const bedrooms = Math.max(1, Number(inp.bedrooms || 1));
  let persons = Math.max(bedrooms + 1, Number(inp.persons_override || 0));
  const flowLpd = Number(rules.water_supply_flows_lpd[inp.water_supply]?.lpd ?? 120);
  const src = rules.wastewater_source_fractions;
  const comp = inp.wastewater_components || { toilet: true, bathroom: true, laundry: true, kitchen: true };

  let fW = 0, fN = 0, fP = 0, fB = 0;
  for (const k of ["toilet", "bathroom", "laundry", "kitchen"]) {
    if (comp[k]) {
      fW += src[k].water;
      fN += src[k].tn;
      fP += src[k].tp;
      fB += src[k].bod;
    }
  }
  if (fW <= 0) fW = 1;

  let epW, epN, epP, epB, totalFlowLd;
  const sourceBreakdown = [];
  let greaseRequired = Boolean(inp.grease_arrestor_required);
  let commKitchenFlowLd = 0;
  let hasSurgeSource = false;
  let weightedBodOverride = null;

  const sources = Array.isArray(inp.wastewater_sources) ? inp.wastewater_sources : [];
  if (sources.length > 0) {
    totalFlowLd = 0;
    let totalEpEquiv = 0, weightedBodNum = 0, totalNMulti = 0, totalPMulti = 0;
    for (const ws of sources) {
      const stype = ws.source_type || "dwelling";
      const units = Math.max(1, Number(ws.units || 1));
      const brPer = Math.max(0, Number(ws.bedrooms_per_unit ?? 2));
      const surge = Math.max(1.0, Number(ws.peak_surge_factor || 1.0));
      let epS, qS, bodS, tnS, tpS, basis;

      if (stype === "dwelling" || stype === "secondary_dwelling") {
        const epPer = ws.guests_per_unit != null ? Number(ws.guests_per_unit) : Math.max(2, brPer + 1);
        epS = units * epPer;
        const rate = Number(ws.flow_rate_lpd_override || flowLpd);
        qS = ws.daily_flow_l_override != null ? Number(ws.daily_flow_l_override) : epS * rate * fW;
        bodS = Number(ws.influent_bod_mgl || 250.0 * (120.0 / Math.max(60.0, rate)));
        tnS = epS * fN * 4.2;
        tpS = epS * fP * 0.52;
        basis = `${units}× ${brPer} BR (${Math.round(epS)} EP @ ${Math.round(rate)} L/p/d)`;
      } else if (stype === "agritourism_cabin") {
        hasSurgeSource = true;
        const epPer = ws.guests_per_unit != null ? Number(ws.guests_per_unit) : Math.max(2, brPer * 2);
        epS = units * epPer;
        const rate = Number(ws.flow_rate_lpd_override || Math.min(flowLpd, 140.0));
        qS = ws.daily_flow_l_override != null ? Number(ws.daily_flow_l_override) : epS * rate * surge;
        bodS = Number(ws.influent_bod_mgl || 250.0);
        tnS = epS * 4.2;
        tpS = epS * 0.52;
        basis = `${units}× cabin (${Math.round(epS)} guests @ ${Math.round(rate)} L/g/d, surge ×${surge.toFixed(1)})`;
      } else if (stype === "day_visitors_amenities") {
        hasSurgeSource = true;
        const rate = Number(ws.flow_rate_lpd_override || 18.0);
        qS = ws.daily_flow_l_override != null ? Number(ws.daily_flow_l_override) : units * rate;
        epS = r2(qS / flowLpd);
        bodS = Number(ws.influent_bod_mgl || 220.0);
        tnS = epS * 4.2;
        tpS = epS * 0.52;
        basis = `${units} day visitors @ ${Math.round(rate)} L/visitor/d (AS/NZS 1547 Table H2)`;
      } else {
        greaseRequired = true;
        hasSurgeSource = true;
        const rate = Number(ws.flow_rate_lpd_override || 25.0);
        qS = ws.daily_flow_l_override != null ? Number(ws.daily_flow_l_override) : units * rate;
        epS = r2(qS / flowLpd);
        bodS = Number(ws.influent_bod_mgl || 650.0);
        tnS = epS * 4.2 * 1.15;
        tpS = epS * 0.52 * 1.3;
        commKitchenFlowLd += qS;
        basis = `Commercial / food processing (${Math.round(qS)} L/d, est. BOD ${Math.round(bodS)} mg/L; Grease Arrestor req.)`;
      }

      if (ws.requires_grease_trap) {
        greaseRequired = true;
        if (stype !== "food_processing_commercial") commKitchenFlowLd += qS * 0.35;
      }

      totalFlowLd += qS;
      totalEpEquiv += epS;
      weightedBodNum += qS * bodS;
      totalNMulti += tnS;
      totalPMulti += tpS;

      sourceBreakdown.push({
        label: ws.label || stype,
        source_type: stype,
        units,
        ep_equivalent: r1(epS),
        daily_flow_ld: r1(qS),
        influent_bod_mgl: r1(bodS),
        requires_grease_trap: Boolean(ws.requires_grease_trap) || stype === "food_processing_commercial",
        basis_note: basis,
      });
    }

    persons = Math.max(1, Math.ceil(totalEpEquiv));
    epW = totalEpEquiv;
    epN = totalNMulti / 4.2;
    epP = totalPMulti / 0.52;
    epB = totalEpEquiv;
    weightedBodOverride = Math.max(20.0, weightedBodNum / Math.max(1.0, totalFlowLd));
  } else {
    epW = persons * fW;
    epN = persons * fN;
    epP = persons * fP;
    epB = persons * fB;
    totalFlowLd = epW * flowLpd;
  }

  const qM3d = totalFlowLd / 1000.0;
  const annualFlowM3 = (totalFlowLd * 365.0) / 1000.0;

  const soil = rules.soil_textures.find((s) => s.id === Number(inp.soil_texture_id || 9)) || rules.soil_textures[8];
  const isSecondary = inp.treatment_system !== "primary_septic";
  const isIrrig = inp.land_application_type !== "eta_beds";
  const maxPerc = isIrrig
    ? soil.ssi_dir
    : isSecondary
      ? soil.secondary_trench_dlr
      : soil.primary_dlr ?? 5.0;

  const rootMm = isIrrig ? 300 : Number(inp.root_zone_depth_mm ?? 300);
  const gravelMm = isIrrig ? 0 : Number(inp.gravel_depth_mm ?? 300);
  const bucketSat = rootMm * soil.porosity_root + gravelMm * soil.porosity_gravel;
  const bucketAwc = rootMm * soil.awc_root;

  const morandCode = String(inp.morand_code || "co").toLowerCase();
  const morand = rules.morand_soil_units[morandCode] || rules.morand_soil_units.co;
  const pSorption = Number(morand.p_sorption || 1000);
  const totalPKgYr = epP * 0.52;
  const wtDepth = Math.max(0.6, Number(inp.site_eval?.depth_to_water_table_m ?? 3.0));
  const phosArea = (totalPKgYr * 10000.0) / ((pSorption * Math.max(0.1, wtDepth - 0.5)) / 50.0 + 20.0);

  // Reed Bed (Headley & Davidson 2003)
  const totalNKgYr = epN * 4.2;
  const tnIn = (1_000_000.0 * totalNKgYr) / 365.0 / totalFlowLd;
  const bodIn = weightedBodOverride != null
    ? Math.max(5.0 + 1e-12, weightedBodOverride)
    : Math.max(5.0 + 1e-12, ((epB / persons) * 250.0) / (flowLpd / 120.0));
  const kvBod = 0.52 * Math.pow(0.953, 24.0 - 20.0);
  const hrtBod = Math.max(0, (Math.log(bodIn - 5.0) - Math.log(15.0)) / kvBod);

  const wettedDepth = Number(inp.reed_bed_wetted_depth_m ?? 0.7);
  let rbArea = 0, rbHrt = 0, nRem = 0, bodOut = bodIn, tnOut = tnIn;
  let rbModel = null, rbCount = 0, rbProvided = 0, rbDims = null;

  if (inp.treatment_system === "secondary_reed_bed") {
    if (inp.reed_bed_area_override_m2 != null && Number(inp.reed_bed_area_override_m2) > 0) {
      rbArea = Number(inp.reed_bed_area_override_m2);
      rbHrt = (rbArea * 0.4 * wettedDepth) / qM3d;
      tnOut = 1.5 + (tnIn - 1.5) * Math.exp(-0.18 * rbHrt);
      bodOut = 5.0 + (bodIn - 5.0) * Math.exp(-kvBod * rbHrt);
    } else {
      rbHrt = hrtBod;
      tnOut = 1.5 + (tnIn - 1.5) * Math.exp(-0.18 * rbHrt);
      bodOut = 20.0;
      rbArea = (rbHrt * qM3d) / (wettedDepth * 0.4);
    }
    nRem = Math.max(0, 1.0 - tnOut / tnIn);
    const bestTray = [...rules.reed_bed_trays].sort((a, b) => Math.abs(a.wetted_depth_m - wettedDepth) - Math.abs(b.wetted_depth_m - wettedDepth))[0];
    rbModel = bestTray.model;
    rbCount = Math.max(1, Math.ceil(rbArea / bestTray.area_m2));
    rbProvided = r2(rbCount * bestTray.area_m2);
    rbDims = {
      length_m: bestTray.length_m,
      width_m: bestTray.width_m,
      depth_m: bestTray.depth_m,
      wetted_depth_m: bestTray.wetted_depth_m,
      area_m2: bestTray.area_m2,
    };
  } else if (inp.treatment_system === "secondary_awts") {
    nRem = 0.2;
    bodOut = 20.0;
    tnOut = tnIn * 0.8;
  }

  // Nitrogen Balance
  const nAvail = totalNKgYr * (1.0 - nRem) * 0.8;
  const bufStd = inp.buffer_feature === "stream" ? 100.0 : 40.0;
  const bufMin = inp.buffer_feature === "stream" ? 50.0 : 20.0;
  const distIntoBuf = Math.max(0, bufStd - Number(inp.buffer_distance_m ?? 45));
  const blockM2 = Math.max(100, Number(inp.block_size_m2 ?? 10000));
  const t1 = (bufMin - distIntoBuf) / bufMin + (distIntoBuf / bufMin) * (600.0 / blockM2);
  const t2 = Math.min(1.0, ((600.0 / blockM2) * (bufStd - distIntoBuf)) / (bufStd - bufMin));
  const modBlockHa = (Math.max(t1, t2) * blockM2) / 10000.0;
  const nPercGranted = 15.0 * (1.0 - Math.exp(-3.0 * modBlockHa));
  const nitroArea = nAvail > 0 ? Math.max(0, ((1.0 - nPercGranted / nAvail) * 10000.0 * nAvail) / 200.0) : 0;

  // Hydraulic Daily Balance (7,670 days)
  const hyd = solveHydraulicArea(totalFlowLd, bucketSat, bucketAwc, maxPerc, rbArea, climate);
  const areaCap = inp.apply_area_cap === false ? 0 : (isSecondary ? 10.0 : 15.0) * epW;

  const candidates = [
    ["Hydraulic", hyd.area],
    ["Nitrogen", nitroArea],
    ["Phosphorus", phosArea],
    ["Minimum Area Cap", areaCap],
  ];
  candidates.sort((a, b) => b[1] - a[1]);
  const [limitingFactor, reqLaa] = candidates[0];

  const hasGrey = comp.bathroom || comp.laundry || comp.kitchen;
  const tankKey = comp.toilet && hasGrey ? "all_wastewater" : comp.toilet ? "blackwater_only" : "greywater_only";
  let septicMinL;
  if (persons <= 5) {
    septicMinL = rules.septic_tank_capacities_l[tankKey]["1_to_5"];
  } else if (persons <= 10) {
    septicMinL = rules.septic_tank_capacities_l[tankKey]["6_to_10"];
  } else {
    septicMinL = Math.max(4500, Math.ceil((Math.max(totalFlowLd, persons * 120) * 3.0) / 500) * 500);
  }
  if (totalFlowLd > 1500) {
    septicMinL = Math.max(septicMinL, Math.ceil((totalFlowLd * 2.5) / 500) * 500);
  }

  let greaseArrestorMinL = 0;
  if (greaseRequired) {
    const autoGrease = Math.max(1000, Math.ceil((Math.max(commKitchenFlowLd, 400) * 1.5) / 500) * 500);
    greaseArrestorMinL = inp.grease_arrestor_capacity_l ? Math.max(1000, Number(inp.grease_arrestor_capacity_l)) : autoGrease;
  }

  let surgeTankMinL = 0;
  if (inp.surge_balance_tank_l && Number(inp.surge_balance_tank_l) > 0) {
    surgeTankMinL = Number(inp.surge_balance_tank_l);
  } else if (hasSurgeSource && totalFlowLd >= 600) {
    surgeTankMinL = Math.max(1500, Math.ceil(totalFlowLd / 500) * 500);
  }

  const exceedsCommercial2000 = totalFlowLd > 2000.0 || persons > 10;

  const tWidth = Number(inp.trench_width_m ?? 2.0);
  const tSep = Number(inp.trench_separation_m ?? 2.0);
  let trenchLayout;
  if (isIrrig) {
    // Per LCC OSmodel Designer sheet ("Envelope width (0 if SSI)"):
    // Irrigation is a contiguous zone (no inter-trench separation gaps).
    const side = r1(Math.sqrt(reqLaa));
    const len = reqLaa / Math.max(1.0, side);
    trenchLayout = {
      laa_m2: r1(reqLaa),
      number_of_trenches: 1,
      trench_width_m: side,
      trench_separation_m: 0.0,
      trench_length_m: r1(len),
      total_bed_area_m2: r1(reqLaa),
      envelope_width_m: side,
      envelope_length_m: r1(len),
      envelope_area_m2: r1(reqLaa),
      exceeds_max_length_20m: false,
      exceeds_3_trenches: false,
    };
  } else {
    const nTrenches = inp.number_of_trenches_override
      ? Number(inp.number_of_trenches_override)
      : Math.max(1, Math.ceil(reqLaa / (tWidth * 20.0)));
    const tLen = reqLaa / (nTrenches * tWidth);
    const envW = nTrenches * tWidth + Math.max(0, nTrenches - 1) * tSep;
    trenchLayout = {
      laa_m2: r1(reqLaa),
      number_of_trenches: nTrenches,
      trench_width_m: r2(tWidth),
      trench_separation_m: r2(tSep),
      trench_length_m: r1(tLen),
      total_bed_area_m2: r1(nTrenches * tWidth * tLen),
      envelope_width_m: r1(envW),
      envelope_length_m: r1(tLen),
      envelope_area_m2: r1(envW * tLen),
      exceeds_max_length_20m: tLen > 20.05,
      exceeds_3_trenches: nTrenches > 3,
    };
  }

  return {
    design_persons: persons,
    flow_rate_lpd: flowLpd,
    total_flow_ld: r1(totalFlowLd),
    annual_flow_m3: r2(annualFlowM3),
    soil_texture_name: soil.name,
    soil_category: soil.category,
    soil_ksat_md: soil.ksat_md,
    max_deep_drainage_mmd: maxPerc,
    bucket_cap_sat_mm: r1(bucketSat),
    bucket_cap_awc_mm: r1(bucketAwc),
    morand_code: morandCode,
    morand_unit_name: morand.unit,
    morand_group: morand.group,
    p_sorption_kg_ha_m: pSorption,
    total_p_kg_yr: r2(totalPKgYr),
    phosphorus_area_m2: r1(phosArea),
    total_n_kg_yr: r2(totalNKgYr),
    n_removal_pct: r1(nRem * 100),
    n_available_to_laa_kg_yr: r2(nAvail),
    n_percolation_granted_kg_yr: r2(nPercGranted),
    nitrogen_area_m2: r1(nitroArea),
    reed_bed_required_m2: r1(rbArea),
    reed_bed_hrt_days: r1(rbHrt),
    reed_bed_bod_inlet_mgl: r1(bodIn),
    reed_bed_bod_outlet_mgl: r1(bodOut),
    reed_bed_tn_inlet_mgl: r1(tnIn),
    reed_bed_tn_outlet_mgl: r1(tnOut),
    recommended_reed_bed_model: rbModel,
    recommended_reed_bed_count: rbCount,
    recommended_reed_bed_provided_m2: rbProvided,
    recommended_reed_bed_dims: rbDims,
    hydraulic_area_m2: r1(hyd.area),
    daily_loading_rate_actual_mmd: r2(totalFlowLd / reqLaa),
    exceedance_days_count: hyd.excCount,
    exceedance_pct_of_days: r2((100.0 * hyd.excCount) / climate.n),
    p95_exceedance_mm: Math.round(hyd.p95 * 10000) / 10000,
    area_cap_m2: r1(areaCap),
    required_laa_m2: r1(reqLaa),
    limiting_factor: limitingFactor,
    reserve_laa_m2: r1(reqLaa),
    septic_tank_min_l: septicMinL,
    septic_retention_days: r1(septicMinL / totalFlowLd),
    source_breakdown: sourceBreakdown,
    weighted_influent_bod_mgl: r1(bodIn),
    grease_arrestor_min_l: greaseArrestorMinL,
    surge_tank_min_l: surgeTankMinL,
    exceeds_commercial_threshold_2000ld: exceedsCommercial2000,
    trench_layout: trenchLayout,
  };
}

export function auditLismoreComplianceJS(inp, spatial, model, rules) {
  const bufs = rules.buffers_m;
  const limits = rules.design_limits;
  const se = inp.site_eval || {};
  const sp = spatial || {};
  const checks = [];
  const departures = [];
  let siteLim = false;
  let soilLim = false;
  let needsSec = false;
  let needsGypsum = false;

  const add = (code, category, parameter, measured, requirement, clause, status, mitigation = null) => {
    checks.push({ code, category, parameter, measured_value: measured, requirement, clause, status, mitigation });
    if (status === "LIMITATION" || status === "FAIL") {
      if (category === "Soil") soilLim = true;
      else if (["Site", "Buffers", "Planning"].includes(category)) siteLim = true;
    }
  };

  // --- 1. SITE LIMITATIONS (Table 6) ---
  const isEta = inp.land_application_type === "eta_beds";
  const slopePct = Number(se.slope_pct ?? 0);
  if (slopePct > limits.eta_max_slope_pct) {
    needsSec = true;
    const st = isEta ? "FAIL" : "LIMITATION";
    const mit = "Secondary treatment + sub-surface irrigation or engineered retaining/terracing required.";
    if (isEta) {
      departures.push(`Site slope (${slopePct}%) exceeds 15% maximum for ETA beds (Strategy Table 6 & Appendix B s3.0).`);
    }
    add("SITE-SLOPE", "Site", "Slope Angle", `${slopePct}%`, "< 15% for ETA beds", "LCC Strategy 2013 Table 6", st, mit);
  } else {
    add("SITE-SLOPE", "Site", "Slope Angle", `${slopePct}%`, "< 15% for ETA beds", "LCC Strategy 2013 Table 6", "PASS");
  }

  const landform = se.landform || "linear_planar";
  const landformNotes = se.landform_notes || "Linear planar slope across proposed disposal area";
  if (landform === "convergent") {
    add(
      "SITE-LANDFORM", "Site", "Landform", landformNotes,
      "Divergent or planar (water-shedding)", "LCC Strategy 2013 Table 6", "LIMITATION",
      "Construct upslope diversion bund/swale above the land application area.",
    );
  } else {
    add("SITE-LANDFORM", "Site", "Landform", landformNotes, "Divergent or planar", "LCC Strategy 2013 Table 6", "PASS");
  }

  const aspectStr = se.aspect || "North";
  const exposureStr = se.exposure || "medium";
  const aspectU = String(aspectStr).toUpperCase();
  if (aspectU.includes("SOUTH") || aspectU.includes("SW") || aspectU.includes("SE") || exposureStr === "low_sheltered") {
    add(
      "SITE-EXPOSURE", "Site", "Aspect & Exposure", `${aspectStr} (${exposureStr} exposure)`,
      "NW/NE quadrant with high sun-wind exposure", "LCC Strategy 2013 Table 6", "LIMITATION",
      "Encourage vigorous perennial grass cover and downslope Lomandra hystrix uptake row; trim overhanging shade trees.",
    );
  } else {
    add("SITE-EXPOSURE", "Site", "Aspect & Exposure", `${aspectStr} (${exposureStr} exposure)`, "NW/NE quadrant, high exposure", "LCC Strategy 2013 Table 6", "PASS");
  }

  const floodNotes = se.flooding_potential || "None (well above 1-in-20 and 1-in-100 year flood levels)";
  if (se.below_1_in_20_flood || se.below_1_in_100_flood || sp.flood_planning) {
    const mit = "Locate treatment system above 1-in-100 year flood level and pump/locate LAA above 1-in-20 year flood level.";
    departures.push("Site intersects flood planning overlay or flood contour constraint (Strategy s5.4.1(h)).");
    add("SITE-FLOOD", "Site", "Flooding Potential", floodNotes, "LAA > 1:20 yr; Treatment > 1:100 yr", "LCC Strategy 2013 s5.4.1(h) & Table 6", "LIMITATION", mit);
  } else {
    add("SITE-FLOOD", "Site", "Flooding Potential", floodNotes, "LAA > 1:20 yr; Treatment > 1:100 yr", "LCC Strategy 2013 s5.4.1(h) & Table 6", "PASS");
  }

  const siteDrain = se.site_drainage || "Good; no channelled runoff or surface dampness observed";
  const waterlogVeg = se.waterlogging_vegetation || "No sedges or bullrushes observed";
  if (se.surface_dampness || se.waterlogging_present) {
    needsSec = true;
    add("SITE-DRAIN", "Site", "Site Drainage & Waterlogging", `${siteDrain}; ${waterlogVeg}`, "No dampness or waterlogging indicator species", "LCC Strategy 2013 Table 6", "LIMITATION", "Provide secondary treatment and upslope diversion drainage.");
  } else {
    add("SITE-DRAIN", "Site", "Site Drainage & Waterlogging", `${siteDrain}; ${waterlogVeg}`, "No dampness or sedges", "LCC Strategy 2013 Table 6", "PASS");
  }

  const surfCond = se.surface_condition || "Grassed with no cracking or ponding";
  if (se.surface_cracking_or_bare) {
    needsSec = true;
    add("SITE-SURF", "Site", "Surface Condition", surfCond, "Grassed, no bare ground or cracking", "LCC Strategy 2013 Table 6", "LIMITATION", "Secondary treatment and establish perennial grass cover over LAA.");
  } else {
    add("SITE-SURF", "Site", "Surface Condition", surfCond, "Grassed, no bare ground or cracking", "LCC Strategy 2013 Table 6", "PASS");
  }

  const fillNotes = se.fill_notes || "None";
  if (se.contains_fill) {
    add("SITE-FILL", "Site", "Fill", fillNotes, "Disposal area not on uncontrolled fill", "LCC Strategy 2013 s5.4.1(l) & Table 6", "LIMITATION", "Relocate LAA off fill or provide geotechnical certification.");
  } else {
    add("SITE-FILL", "Site", "Fill", fillNotes, "No uncontrolled fill", "LCC Strategy 2013 s5.4.1(l) & Table 6", "PASS");
  }

  const erosionNotes = se.erosion_notes || "No rills, slips, or mass movement observed";
  if (se.erosion_present) {
    add("SITE-EROSION", "Site", "Erosion / Mass Movement", erosionNotes, "No rills, slips, or mass movement", "LCC Strategy 2013 Table 6", "LIMITATION", "Stabilise with deep-rooted vegetation and upslope runoff diversion.");
  } else {
    add("SITE-EROSION", "Site", "Erosion / Mass Movement", erosionNotes, "No rills, slips, or mass movement", "LCC Strategy 2013 Table 6", "PASS");
  }

  // --- 2. BUFFER DISTANCES (s5.4.1f & Table 6) ---
  if (se.dist_perennial_watercourse_m != null) {
    const req = bufs.perennial_or_intermittent_watercourse.required_m;
    const val = Number(se.dist_perennial_watercourse_m);
    if (val < req) {
      needsSec = true;
      departures.push(`LAA is ${val} m from perennial/intermittent watercourse (< ${req} m buffer).`);
      add("BUF-WATER", "Buffers", "Perennial/Intermittent Watercourse", `${val} m`, `>= ${req} m`, bufs.perennial_or_intermittent_watercourse.clause, "LIMITATION", "Maximise buffer distance and provide secondary treatment (with disinfection if required).");
    } else {
      add("BUF-WATER", "Buffers", "Perennial/Intermittent Watercourse", `${val} m`, `>= ${req} m`, bufs.perennial_or_intermittent_watercourse.clause, "PASS");
    }
  } else if (sp.nearest_watercourse_m != null) {
    const req = bufs.perennial_or_intermittent_watercourse.required_m;
    const val = Number(sp.nearest_watercourse_m);
    const st = val >= req ? "PASS" : "INFO";
    add("BUF-WATER-GIS", "Buffers", "Nearest Mapped Watercourse (Parcel Edge)", `${val.toFixed(1)} m`, `>= ${req} m from LAA`, bufs.perennial_or_intermittent_watercourse.clause, st, "Confirm exact LAA-to-watercourse setback on site plan.");
  }

  if (se.dist_gully_m != null) {
    const req = bufs.gully_ephemeral.required_m;
    const val = Number(se.dist_gully_m);
    if (val < req) {
      needsSec = true;
      departures.push(`LAA is ${val} m from ephemeral gully (< ${req} m buffer).`);
      add("BUF-GULLY", "Buffers", "Gully / Ephemeral Stream", `${val} m`, `>= ${req} m`, bufs.gully_ephemeral.clause, "LIMITATION", "Maximise buffer and provide secondary treatment.");
    } else {
      add("BUF-GULLY", "Buffers", "Gully / Ephemeral Stream", `${val} m`, `>= ${req} m`, bufs.gully_ephemeral.clause, "PASS");
    }
  }

  if (se.dist_domestic_bore_m != null) {
    const req = bufs.domestic_groundwater_bore.required_m;
    const val = Number(se.dist_domestic_bore_m);
    const st = val >= req ? "PASS" : "LIMITATION";
    if (st === "LIMITATION") {
      needsSec = true;
      departures.push(`LAA is ${val} m from domestic groundwater bore (< ${req} m buffer).`);
    }
    add("BUF-BORE", "Buffers", "Domestic Groundwater Bore/Well", `${val} m`, `>= ${req} m`, bufs.domestic_groundwater_bore.clause, st);
  }

  if (se.dist_property_boundary_m != null) {
    const isDown = se.boundary_is_downgradient !== false;
    const key = isEta
      ? isDown ? "property_boundary_eta_downgradient" : "property_boundary_eta_upgradient"
      : isDown ? "property_boundary_ssi_downgradient" : "property_boundary_ssi_upgradient";
    const req = bufs[key].required_m;
    const val = Number(se.dist_property_boundary_m);
    const st = val >= req ? "PASS" : "LIMITATION";
    if (st === "LIMITATION") {
      needsSec = true;
      departures.push(`LAA setback to property boundary (${val} m) is below ${req} m requirement.`);
    }
    add("BUF-BOUNDARY", "Buffers", "Property Boundary Setback", `${val} m`, `>= ${req} m`, bufs[key].clause, st);
  }

  if (se.septic_to_dwelling_m != null) {
    const req = bufs.septic_tank_to_building.required_m;
    const val = Number(se.septic_to_dwelling_m);
    const st = val >= req ? "PASS" : "FAIL";
    add("BUF-SEPTIC", "Buffers", "Septic Tank to Building", `${val} m`, `> ${req} m`, bufs.septic_tank_to_building.clause, st);
  }

  // --- 3. SOIL LIMITATIONS (Table 7 & s5.4.2) ---
  const morandCode = String(inp.morand_code || "co").toLowerCase();
  const morand = rules.morand_soil_units[morandCode] || {};
  if (morand.unsuitable) {
    departures.push(`Morand soil unit '${morand.unit}' (${morandCode}) is flagged unsuitable for standard effluent disposal (Strategy Table 1).`);
    add("SOIL-MORAND", "Soil", "Morand (1994) Soil Unit", `${morand.unit} (${morandCode})`, "Suitable soil landscape", "LCC Strategy 2013 Table 1", "FAIL", morand.limitations || null);
  } else {
    add("SOIL-MORAND", "Soil", "Morand (1994) Soil Unit", `${morand.unit || morandCode} (${morandCode}) — P-sorption ${Number(model.p_sorption_kg_ha_m || 0).toLocaleString()} kg/ha/m`, "Identify desktop soil unit & limitations", "LCC Strategy 2013 s5.4.2 Table 1", "PASS", morand.limitations || null);
  }

  const bhs = inp.boreholes || [];
  const minDepth = bhs.length
    ? Math.min(...bhs.map((b) => Math.max(0, ...(b.horizons || []).map((h) => Number(h.depth_bottom_mm || 0)))))
    : 0;
  if (bhs.length < limits.min_boreholes || minDepth < limits.min_borehole_depth_mm) {
    departures.push(`Borehole assessment has ${bhs.length} borehole(s) (min depth ${minDepth} mm); Lismore Strategy s5.4.3 requires minimum 2 boreholes to >= 1000 mm.`);
    add(
      "SOIL-BOREHOLES", "Soil", "Borehole Coverage & Depth",
      `${bhs.length} borehole(s), min depth ${minDepth} mm`,
      ">= 2 boreholes to >= 1000 mm depth",
      "LCC Strategy 2013 s5.4.2(h) & s5.4.3 p.35",
      "LIMITATION",
      "Complete second borehole to >= 1000 mm across LAA high/low points prior to lodgement.",
    );
  } else {
    add("SOIL-BOREHOLES", "Soil", "Borehole Coverage & Depth", `${bhs.length} boreholes, min depth ${minDepth} mm`, ">= 2 boreholes to >= 1000 mm", "LCC Strategy 2013 s5.4.3 p.35", "PASS");
  }

  const allH = bhs.flatMap((b) => b.horizons || []);
  const worstDisp = allH.reduce((m, h) => (h.dispersive_class != null ? Math.max(m, Number(h.dispersive_class)) : m), 1);
  const minPh = allH.reduce((m, h) => (h.ph != null ? Math.min(m, Number(h.ph)) : m), 6.5);
  const maxCf = allH.reduce((m, h) => Math.max(m, Number(h.coarse_fragments_pct || 0)), 0.0);

  if (worstDisp >= 3) {
    needsSec = true;
    needsGypsum = true;
    add(
      "SOIL-DISP", "Soil", "Dispersiveness (Modified Emerson SAR 5)",
      `Class ${worstDisp}`, "Class 1 or 2 (non-dispersive)",
      "LCC Strategy 2013 s5.4.2(g) & Table 7", "LIMITATION",
      "Provide secondary treatment and ameliorate disposal area base with gypsum at 1.0 kg/m2; recommend low-sodium detergents.",
    );
  } else {
    add("SOIL-DISP", "Soil", "Dispersiveness (Modified Emerson SAR 5)", `Class ${worstDisp}`, "Class 1 or 2", "LCC Strategy 2013 s5.4.2(g) & Table 7", "PASS");
  }

  if (minPh <= limits.ideal_ph_min) {
    needsSec = true;
    add(
      "SOIL-PH", "Soil", "Field pH", `${minPh.toFixed(1)}`, "> 5.5 (ideal 6.5 - 8.0)",
      "LCC Strategy 2013 s5.4.2(f) & Table 7", "LIMITATION",
      "Secondary treatment; condition topsoil with agricultural lime if pH < 5.5 to assist plant nutrient uptake.",
    );
  } else {
    add("SOIL-PH", "Soil", "Field pH", `${minPh.toFixed(1)}`, "> 5.5", "LCC Strategy 2013 s5.4.2(f) & Table 7", "PASS");
  }

  if (maxCf > 20.0) {
    add(
      "SOIL-COARSE", "Soil", "Coarse Fragments", `${Math.round(maxCf)}%`, "< 20% of soil volume",
      "LCC Strategy 2013 Table 5 & Table 7", "LIMITATION",
      "Increase Soil Category by one class if larger pores are absent.",
    );
  } else {
    add("SOIL-COARSE", "Soil", "Coarse Fragments", `${Math.round(maxCf)}%`, "< 20% of soil volume", "LCC Strategy 2013 Table 5 & Table 7", "PASS");
  }

  if (model.soil_category >= 6) {
    needsSec = true;
    add(
      "SOIL-CAT", "Soil", "Soil Category (Most Limiting Layer)", `Category ${model.soil_category} (${model.soil_texture_name})`,
      "Categories 1-5", "LCC Strategy 2013 s5.4.4 & Table 7", "LIMITATION",
      "Secondary treatment required; ameliorate dispersive clays with gypsum and model conservatively.",
    );
  } else {
    add("SOIL-CAT", "Soil", "Soil Category (Most Limiting Layer)", `Category ${model.soil_category} (${model.soil_texture_name})`, "Categories 1-5", "LCC Strategy 2013 Table 4 & Table 7", "PASS");
  }

  const wtDepth = Number(se.depth_to_water_table_m ?? 3.0);
  if (wtDepth < 1.0) {
    needsSec = true;
    add("SOIL-DEPTH", "Soil", "Depth to Water Table / Bedrock", `${wtDepth.toFixed(1)} m`, ">= 1.0 m", "LCC Strategy 2013 s5.4.2(h) & Table 7", "LIMITATION", "Secondary treatment with disinfection and shallow sub-surface irrigation or mound system.");
  } else {
    add("SOIL-DEPTH", "Soil", "Depth to Water Table / Bedrock", `${wtDepth.toFixed(1)} m`, ">= 1.0 m", "LCC Strategy 2013 s5.4.2(h) & Table 7", "PASS");
  }

  // --- 4. TREATMENT & LAND APPLICATION RULES ---
  const isSecondary = inp.treatment_system !== "primary_septic";
  if (needsSec && !isSecondary) {
    departures.push("Site/soil limitations trigger secondary treatment, but Primary-only system is nominated.");
    add("TRT-LEVEL", "Treatment", "Treatment Level", inp.treatment_system, "Secondary treatment required", "LCC Strategy 2013 Tables 6 & 7", "FAIL", "Upgrade to Reed Bed or NSW Health accredited AWTS.");
  } else {
    add("TRT-LEVEL", "Treatment", "Treatment Level", inp.treatment_system, "Appropriate for site/soil class", "LCC Strategy 2013 Appendix A", "PASS");
  }

  if (inp.treatment_system === "secondary_reed_bed") {
    if (model.reed_bed_hrt_days < limits.reed_bed_min_hrt_days_secondary) {
      departures.push(`Reed bed HRT (${model.reed_bed_hrt_days} d) is below 5-day minimum for secondary treatment.`);
      add("TRT-RB-HRT", "Treatment", "Reed Bed Hydraulic Retention Time", `${model.reed_bed_hrt_days} days`, ">= 5.0 days (7.0 days standard)", "LCC Strategy 2013 Appendix A s4.0", "FAIL", "Increase reed bed tray area or wetted depth.");
    } else {
      add("TRT-RB-HRT", "Treatment", "Reed Bed Hydraulic Retention Time", `${model.reed_bed_hrt_days} days (N removal ${model.n_removal_pct}%)`, ">= 5.0 days & >= 50% N removal", "LCC Strategy 2013 Appendix A s4.0 & Reed Bed Guide s3.0", "PASS");
    }
  }

  if (isEta) {
    if (model.trench_layout.exceeds_max_length_20m) {
      departures.push(`ETA bed length (${model.trench_layout.trench_length_m} m) exceeds 20 m maximum (Appendix B Design 1).`);
      add("LAA-LEN", "Land Application", "ETA Bed Length", `${model.trench_layout.trench_length_m} m`, "<= 20.0 m (centrally fed)", "LCC Strategy 2013 Appendix B Design 1", "FAIL", "Split LAA into additional parallel trenches separated by >= 2.0 m.");
    } else {
      add("LAA-LEN", "Land Application", "ETA Bed Length", `${model.trench_layout.trench_length_m} m`, "<= 20.0 m (centrally fed)", "LCC Strategy 2013 Appendix B Design 1", "PASS");
    }

    if (model.trench_layout.exceeds_3_trenches) {
      add("LAA-TRENCHES", "Land Application", "Number of ETA Trenches", String(model.trench_layout.number_of_trenches), "<= 3 via distribution box", "LCC Strategy 2013 Appendix B s3.0", "LIMITATION", "Use indexing valve / dosing manifold rather than passive distribution box.");
    } else {
      add("LAA-TRENCHES", "Land Application", "Number of ETA Trenches", String(model.trench_layout.number_of_trenches), "<= 3 via distribution box", "LCC Strategy 2013 Appendix B s3.0", "PASS");
    }
  } else {
    add("LAA-ZONE", "Land Application", "Contiguous Irrigation Zone", `${model.trench_layout.trench_length_m} m × ${model.trench_layout.trench_width_m} m (${model.required_laa_m2} m²)`, "Tertiary disinfected effluent + CIDP", "LCC Strategy 2013 Appendix B s4.0", "PASS");
  }

  const reserveAvailable = se.reserve_laa_available !== false;
  if (!reserveAvailable) {
    departures.push("No alternate (reserve) land application area nominated (Strategy s1.1).");
    add("LAA-RESERVE", "Land Application", "Reserve LAA", "Not available", `>= ${model.reserve_laa_m2} m2 nominated`, "LCC Strategy 2013 Part B s1.1", "FAIL");
  } else {
    add("LAA-RESERVE", "Land Application", "Reserve LAA", `Available (>= ${model.reserve_laa_m2} m2)`, "Alternate reserve LAA nominated", "LCC Strategy 2013 Part B s1.1", "PASS");
  }

  // --- 5. PLANNING OVERLAYS (Rous Water, ASS, Irrigation Certification) ---
  const requiresCidp = !isEta;
  if (sp.drinking_water_catchment) {
    departures.push("Property lies within a mapped Drinking Water Catchment — Rous Water On-site Wastewater Management Guidelines (2008) apply.");
    add("PLAN-DWC", "Planning", "Drinking Water Catchment", "Mapped Inside Catchment", "Comply with Rous Water Guidelines (2008)", "LCC Strategy 2013 Part B s1.1 & s5.1", "LIMITATION", "Include Rous Water Guidelines risk assessment and enhanced pathogen/nutrient barriers.");
  } else {
    add("PLAN-DWC", "Planning", "Drinking Water Catchment", "Outside mapped catchment", "Rous Water Guidelines if inside", "LCC Strategy 2013 Part B s1.1", "PASS");
  }

  const assList = Array.isArray(sp.acid_sulfate_soils) ? sp.acid_sulfate_soils : [];
  if (assList.length > 0) {
    add("PLAN-ASS", "Planning", "Acid Sulfate Soils (ASS)", assList.join(", "), "Check ASS Risk Map for excavation", "LCC Strategy 2013 s5.4.2(i)", "LIMITATION", "Limit excavation depth and prepare ASS management notes if below threshold.");
  } else {
    add("PLAN-ASS", "Planning", "Acid Sulfate Soils (ASS)", "None mapped", "Check ASS Risk Map", "LCC Strategy 2013 s5.4.2(i)", "PASS");
  }

  if (requiresCidp) {
    add("PLAN-CIDP", "Land Application", "Certified Irrigation Design Plan (CIDP)", "Irrigation nominated", "Appendix C & D certified by CID", "LCC Strategy 2013 Part B s1.1 & Appendix B s4.0", "LIMITATION", "Attach Certified Irrigation Design Plan (A3 1:200 & 1:250) with Appendix C & D checklists.");
  }

  // --- 6. MULTI-USE / AGRITOURISM / COMMERCIAL & GREASE ARRESTOR CHECKS ---
  const requiresGrease = (model.grease_arrestor_min_l || 0) > 0;
  const requiresCommercial = Boolean(model.exceeds_commercial_threshold_2000ld) || (model.source_breakdown || []).some((s) => s.source_type === "food_processing_commercial");

  if (requiresGrease) {
    add("COMM-GREASE", "Commercial", "Commercial Grease Arrestor (FOG Pre-Treatment)", `${model.grease_arrestor_min_l} L Grease Arrestor nominated`, ">= 1,000 L pre-treatment prior to septic/secondary tank", "AS/NZS 3500.2 & NSW Liquid Trade Waste Guidelines", "PASS", "Pump out grease arrestor every 3–6 months via licensed liquid waste contractor; retain dockets for Council.");
  }
  if ((model.surge_tank_min_l || 0) > 0) {
    add("COMM-SURGE", "Commercial", "Flow Equalisation / Surge Balance Tank", `${model.surge_tank_min_l} L Balance Tank nominated`, "Attenuate peak weekend / batch hydraulic surges", "AS/NZS 1547:2012 Appendix H & LCC Strategy s5.3", "PASS", "Time-dose treated/primary effluent evenly across 24 hours to prevent hydraulic shock to reed bed and LAA.");
  }
  if (model.exceeds_commercial_threshold_2000ld) {
    departures.push(
      `Combined daily design flow (${Math.round(model.total_flow_ld)} L/d; ${model.design_persons} EP) exceeds single-household ` +
      `2,000 L/d / 10 EP threshold — commercial/multi-use engineering review & NSW Health commercial accreditation check required.`,
    );
    add("COMM-FLOW", "Commercial", "Commercial / Multi-Use Flow Threshold", `${Math.round(model.total_flow_ld)} L/day (${model.design_persons} EP)`, "<= 2,000 L/d or <= 10 EP for standard domestic pathway", "LCC Strategy 2013 Part A s1.2 & NSW Health Accreditation", "LIMITATION", "Provide commercial-scale treatment specification, surge equalisation, and Council pre-lodgement consultation.");
  }

  return {
    site_has_limitations: siteLim,
    soil_has_limitations: soilLim,
    overall_no_limitations: !(siteLim || soilLim),
    requires_secondary_treatment: needsSec,
    requires_gypsum: needsGypsum,
    gypsum_rate_kg_m2: needsGypsum ? 1.0 : 0.0,
    requires_rous_water_assessment: Boolean(sp.drinking_water_catchment),
    requires_certified_irrigation_design: requiresCidp,
    requires_grease_arrestor: requiresGrease,
    requires_commercial_assessment: requiresCommercial,
    departures_from_strategy: departures,
    checks,
  };
}

function escXml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderCadLayoutSvg(inp, model) {
  const tr = model.trench_layout;
  const hasRb = inp.treatment_system === "secondary_reed_bed";
  const isIrrig = inp.land_application_type !== "eta_beds";
  const W = 740;
  const cx = W / 2;

  // Shared true metric scale (px per metre) across Reed Bed tubs AND LAA beds/zone
  const pxPerM = isIrrig
    ? Math.min(20, 390 / Math.max(8, tr.trench_length_m))
    : Math.min(20, (W - 200) / Math.max(8, tr.trench_length_m));

  // Resolve exact rigid reed bed tub physical dimensions (metres)
  const rbDims = model.recommended_reed_bed_dims || (
    String(model.recommended_reed_bed_model || "").toLowerCase().includes("standard")
      ? { length_m: 3.1, width_m: 2.0, depth_m: 0.64, area_m2: 6.2 }
      : String(model.recommended_reed_bed_model || "").toLowerCase().includes("extra deep")
        ? { length_m: 3.1, width_m: 2.0, depth_m: 0.94, area_m2: 6.2 }
        : { length_m: 3.0, width_m: 1.9, depth_m: 0.87, area_m2: 5.7 }
  );
  const nTrays = hasRb ? Math.max(1, model.recommended_reed_bed_count || 1) : 0;
  const tubPxW = Math.max(24, Math.round(rbDims.length_m * pxPerM));
  const tubPxH = Math.max(16, Math.round(rbDims.width_m * pxPerM));
  const tubGapPx = Math.max(8, Math.round(0.5 * pxPerM));

  const dwW = 175, dwH = 78, dwY = 46;
  const stY = dwY + dwH + 44;
  const rbY = stY + 46;

  // Lay out nTrays rigid tubs in series at true pxPerM scale (wrap to 2 rows only if > 540px wide)
  const maxRbRowW = W - 180;
  const maxPerRow = Math.max(1, Math.floor((maxRbRowW + tubGapPx) / (tubPxW + tubGapPx)));
  const rbRows = hasRb ? Math.ceil(nTrays / maxPerRow) : 0;
  const rbFirstRowCount = hasRb ? Math.min(nTrays, maxPerRow) : 0;
  const rbRowW = rbFirstRowCount * tubPxW + Math.max(0, rbFirstRowCount - 1) * tubGapPx;
  const rbRowGapPx = 12;
  const rbArrayH = hasRb ? rbRows * tubPxH + (rbRows - 1) * rbRowGapPx : 0;
  // Place label on right when there is >= 215px margin, otherwise cleanly below tubs
  const rbLabelRight = hasRb && (W - (cx + rbRowW / 2 + 16)) >= 215;
  const rbBlockBottomY = hasRb ? rbY + rbArrayH + (rbLabelRight ? 0 : 32) : stY + 20;

  let rbSvg = "";
  let rbLabelOverlaySvg = "";
  if (hasRb) {
    let tubsMarkup = "";
    for (let t = 0; t < nTrays; t++) {
      const row = Math.floor(t / maxPerRow);
      const col = t % maxPerRow;
      const countInRow = Math.min(maxPerRow, nTrays - row * maxPerRow);
      const thisRowW = countInRow * tubPxW + Math.max(0, countInRow - 1) * tubGapPx;
      const tx = cx - thisRowW / 2 + col * (tubPxW + tubGapPx);
      const ty = rbY + row * (tubPxH + rbRowGapPx);

      tubsMarkup += `
        <rect x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" width="${tubPxW}" height="${tubPxH}" fill="#bbf7d0" stroke="#166534" stroke-width="2" />
        <text x="${(tx + tubPxW / 2).toFixed(1)}" y="${(ty + tubPxH / 2 + 3.5).toFixed(1)}" text-anchor="middle" font-size="${tubPxW < 42 ? 8 : 9.5}" font-weight="800" fill="#14532d">RB${t + 1}</text>
      `;
      if (col < countInRow - 1) {
        tubsMarkup += `<line x1="${(tx + tubPxW).toFixed(1)}" y1="${(ty + tubPxH / 2).toFixed(1)}" x2="${(tx + tubPxW + tubGapPx).toFixed(1)}" y2="${(ty + tubPxH / 2).toFixed(1)}" stroke="#dc2626" stroke-width="2" />`;
      }
    }
    const labelX = rbLabelRight ? cx + rbRowW / 2 + 14 : cx;
    const labelAnchor = rbLabelRight ? "start" : "middle";
    const labelY1 = rbLabelRight ? rbY + Math.max(14, rbArrayH / 2 - 4) : rbY + rbArrayH + 16;
    const labelY2 = labelY1 + 13;

    rbSvg = `
      <line x1="${cx}" y1="${stY + 20}" x2="${cx}" y2="${rbY - 2}" stroke="#dc2626" stroke-width="2" marker-end="url(#arrow)" />
      ${tubsMarkup}
    `;
    rbLabelOverlaySvg = `
      ${!rbLabelRight ? `<rect x="${(cx - 196).toFixed(1)}" y="${(labelY1 - 12).toFixed(1)}" width="392" height="30" rx="5" fill="rgba(255,255,255,0.95)" stroke="#86efac" stroke-width="1" />` : ""}
      <text x="${labelX.toFixed(1)}" y="${labelY1.toFixed(1)}" text-anchor="${labelAnchor}" font-size="10.5" font-weight="700" fill="#14532d">${nTrays}× ${escXml(model.recommended_reed_bed_model)} (${rbDims.length_m.toFixed(1)}×${rbDims.width_m.toFixed(1)} m)</text>
      <text x="${labelX.toFixed(1)}" y="${labelY2.toFixed(1)}" text-anchor="${labelAnchor}" font-size="9.4" fill="#14532d">${model.recommended_reed_bed_provided_m2} m² provided · HRT ${model.reed_bed_hrt_days} d · N Rem ${model.n_removal_pct}%</text>
    `;
  }

  // Pump well needed for pressurised irrigation
  const pumpY = hasRb ? rbBlockBottomY + 38 : stY + 52;
  const laaStartY = isIrrig
    ? pumpY + 56
    : hasRb
      ? rbBlockBottomY + 54
      : stY + 66;

  let laaSvg = "";
  let laaBottomY = laaStartY;
  let laaDrawW = 380;

  if (isIrrig) {
    // Contiguous Irrigation Zone (SDI or Spray) — drawn at exact pxPerM scale
    laaDrawW = Math.max(200, Math.round(tr.trench_length_m * pxPerM));
    const zoneH = Math.max(96, Math.min(190, Math.round(tr.trench_width_m * pxPerM)));
    laaBottomY = laaStartY + zoneH;

    // Draw parallel dripper laterals (1.0 m schematic spacing)
    const nLaterals = 7;
    let lateralsSvg = "";
    for (let i = 1; i <= nLaterals; i++) {
      const ly = laaStartY + (i * zoneH) / (nLaterals + 1);
      lateralsSvg += `<line x1="${cx - laaDrawW / 2 + 12}" y1="${ly}" x2="${cx + laaDrawW / 2 - 12}" y2="${ly}" stroke="#0284c7" stroke-width="1.3" stroke-dasharray="5,4" />`;
    }
    // Left supply manifold + right flush manifold
    const manifoldSvg = `
      <line x1="${cx - laaDrawW / 2 + 12}" y1="${laaStartY + 10}" x2="${cx - laaDrawW / 2 + 12}" y2="${laaBottomY - 10}" stroke="#dc2626" stroke-width="2.2" />
      <line x1="${cx + laaDrawW / 2 - 12}" y1="${laaStartY + 10}" x2="${cx + laaDrawW / 2 - 12}" y2="${laaBottomY - 10}" stroke="#0369a1" stroke-width="1.8" />
    `;
    const irrigLabel = inp.land_application_type === "surface_spray_irrigation"
      ? "SURFACE SPRAY IRRIGATION ZONE (Disinfected)"
      : "SUB-SURFACE DRIP IRRIGATION ZONE (SDI)";

    laaSvg = `
      <!-- Pump well & indexing valve -->
      <line x1="${cx}" y1="${hasRb ? rbY + rbArrayH : stY + 20}" x2="${cx}" y2="${pumpY - 15}" stroke="#dc2626" stroke-width="2" marker-end="url(#arrow)" />
      <circle cx="${cx}" cy="${pumpY}" r="15" fill="#e0f2fe" stroke="#0369a1" stroke-width="2" />
      <text x="${cx}" y="${pumpY + 4}" text-anchor="middle" font-size="9.5" font-weight="800" fill="#0c4a6e">P</text>
      <text x="${cx + 24}" y="${pumpY - 2}" font-size="10.5" font-weight="700" fill="#0c4a6e">1800 L Pump Well + Alarm &amp; Disc Filter</text>
      <text x="${cx + 24}" y="${pumpY + 11}" font-size="9.5" fill="#0369a1">Indexing Valve · Min 0.8 m/s Flush Velocity (CIDP)</text>
      <line x1="${cx}" y1="${pumpY + 15}" x2="${cx}" y2="${laaStartY - 2}" stroke="#dc2626" stroke-width="2" marker-end="url(#arrow)" />

      <!-- Contiguous Irrigation Field -->
      <rect x="${cx - laaDrawW / 2}" y="${laaStartY}" width="${laaDrawW}" height="${zoneH}" fill="#ecfeff" stroke="#0e7490" stroke-width="2.2" />
      ${lateralsSvg}
      ${manifoldSvg}
      <rect x="${cx - 155}" y="${laaStartY + zoneH / 2 - 20}" width="310" height="40" rx="6" fill="rgba(255,255,255,0.92)" stroke="#0e7490" stroke-width="1" />
      <text x="${cx}" y="${laaStartY + zoneH / 2 - 3}" text-anchor="middle" font-size="11" font-weight="800" fill="#155e75">${irrigLabel}</text>
      <text x="${cx}" y="${laaStartY + zoneH / 2 + 12}" text-anchor="middle" font-size="10.5" font-weight="600" fill="#0e7490">
        ${tr.trench_length_m.toFixed(1)} m × ${tr.trench_width_m.toFixed(1)} m = ${model.required_laa_m2} m² (0 m trench separation · ~${Math.round(model.required_laa_m2)} m laterals)
      </text>
    `;
  } else {
    // ETA Beds: drawn at exact shared pxPerM scale so Reed Bed & ETA Beds match true proportions!
    const nBeds = tr.number_of_trenches;
    laaDrawW = Math.max(200, Math.min(W - 180, Math.round(tr.trench_length_m * pxPerM)));
    const bedH = Math.max(22, Math.min(44, Math.round(tr.trench_width_m * pxPerM)));
    const sepPx = Math.max(14, Math.min(40, Math.round(tr.trench_separation_m * pxPerM)));

    let bedsHtml = `
      <line x1="${cx}" y1="${hasRb ? rbY + rbArrayH : stY + 20}" x2="${cx}" y2="${laaStartY - 2}" stroke="#dc2626" stroke-width="2" marker-end="url(#arrow)" />
    `;
    // Manifold spine connecting multiple beds when nBeds > 1
    if (nBeds > 1) {
      const spineEndY = laaStartY + (nBeds - 1) * (bedH + sepPx) + bedH / 2;
      bedsHtml += `<line x1="${cx}" y1="${laaStartY}" x2="${cx}" y2="${spineEndY}" stroke="#dc2626" stroke-width="1.8" />`;
    }
    for (let i = 0; i < nBeds; i++) {
      const by = laaStartY + i * (bedH + sepPx);
      laaBottomY = by + bedH;
      const bedLabel = `ETA BED ${i + 1}: ${tr.trench_length_m.toFixed(1)} m × ${tr.trench_width_m.toFixed(1)} m`;
      bedsHtml += `
        <rect x="${cx - laaDrawW / 2}" y="${by}" width="${laaDrawW}" height="${bedH}" fill="#dbeafe" stroke="#1e40af" stroke-width="1.8" />
        <line x1="${cx - laaDrawW / 2 + 8}" y1="${by + bedH / 2}" x2="${cx + laaDrawW / 2 - 8}" y2="${by + bedH / 2}" stroke="#dc2626" stroke-width="1.4" stroke-dasharray="6,4" />
        <rect x="${cx - 96}" y="${by + bedH / 2 - 8}" width="192" height="16" rx="4" fill="rgba(219,234,254,0.92)" />
        <text x="${cx}" y="${by + bedH / 2 + 4}" text-anchor="middle" font-size="${nBeds > 6 ? 9.2 : 10}" font-weight="700" fill="#1e3a8a">
          ${bedLabel}
        </text>
      `;
    }
    laaSvg = bedsHtml;
  }

  const vegY = laaBottomY + 20;
  const resY = vegY + 18;
  const resH = isIrrig ? 52 : 38;
  const H = resY + resH + 64; // Dynamic SVG height so ALL beds + reserve + footer ALWAYS fit!

  // Graphic metric scale bar (exact pxPerM)
  const barMeters = pxPerM >= 15 ? 5 : 10;
  const barPx = Math.round(barMeters * pxPerM);
  const barX = W - 26 - barPx;
  const barY = 58;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="background:#fff; border:1px solid #d7dfd9; border-radius:10px; font-family:Inter,sans-serif;">
    <defs>
      <pattern id="grid" width="18" height="18" patternUnits="userSpaceOnUse">
        <path d="M 18 0 L 0 0 0 18" fill="none" stroke="#eef2f0" stroke-width="1"/>
      </pattern>
      <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#dc2626" />
      </marker>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#grid)" />
    <text x="${W / 2}" y="24" text-anchor="middle" font-size="13" font-weight="800" fill="#0d241b">
      SCALED OSSM LAYOUT PREVIEW — ${escXml(inp.site_address)} (Lot ${escXml(inp.lot_number)} ${escXml(inp.plan_label)})
    </text>

    <!-- North arrow -->
    <g transform="translate(44, 56)">
      <line x1="0" y1="36" x2="0" y2="6" stroke="#0d241b" stroke-width="2.5" />
      <polygon points="0,0 -6,12 6,12" fill="#0d241b" />
      <text x="0" y="-4" text-anchor="middle" font-size="13" font-weight="800" fill="#0d241b">N</text>
    </g>

    <!-- True Metric Scale Bar (Reed Bed & LAA) -->
    <g>
      <text x="${barX + barPx / 2}" y="${barY - 5}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#0d241b">SCALE BAR: ${barMeters} m</text>
      <rect x="${barX}" y="${barY}" width="${Math.round(barPx / 2)}" height="6" fill="#0d241b" />
      <rect x="${barX + Math.round(barPx / 2)}" y="${barY}" width="${barPx - Math.round(barPx / 2)}" height="6" fill="#ffffff" stroke="#0d241b" stroke-width="1" />
      <text x="${barX}" y="${barY + 16}" text-anchor="middle" font-size="7.8" fill="#52635c">0</text>
      <text x="${barX + barPx}" y="${barY + 16}" text-anchor="middle" font-size="7.8" fill="#52635c">${barMeters} m</text>
    </g>

    <!-- 3m building clearance and Dwelling -->
    <rect x="${cx - dwW / 2 - 20}" y="${dwY - 10}" width="${dwW + 40}" height="${dwH + 20}" fill="none" stroke="#d97706" stroke-width="1.3" stroke-dasharray="6,4" />
    <rect x="${cx - dwW / 2}" y="${dwY}" width="${dwW}" height="${dwH}" fill="#e2e8f0" stroke="#0f172a" stroke-width="2" />
    <text x="${cx}" y="${dwY + dwH / 2 + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="#0f172a">DWELLING (${inp.bedrooms} BR / ${model.design_persons} EP)</text>

    <!-- Pipe dwelling -> septic -->
    <line x1="${cx}" y1="${dwY + dwH}" x2="${cx}" y2="${stY - 20}" stroke="#dc2626" stroke-width="2" marker-end="url(#arrow)" />

    <!-- Septic Tank -->
    <circle cx="${cx}" cy="${stY}" r="20" fill="#fed7aa" stroke="#9a3412" stroke-width="2" />
    <line x1="${cx - 20}" y1="${stY}" x2="${cx + 20}" y2="${stY}" stroke="#9a3412" stroke-width="1.5" />
    <text x="${cx + 30}" y="${stY - 3}" font-size="11.5" font-weight="700" fill="#7c2d12">${model.septic_tank_min_l} L Septic Tank</text>
    <text x="${cx + 30}" y="${stY + 12}" font-size="10" fill="#7c2d12">Baffle + External Outlet Filter (${model.septic_retention_days} d HRT)</text>

    <!-- Scaled Rigid Reed Bed Tubs (same pxPerM scale as LAA!) -->
    ${rbSvg}

    <!-- Upslope Diversion Swale -->
    <polyline points="${cx - laaDrawW / 2 - 24},${laaStartY - 10} ${cx - laaDrawW / 2 - 8},${laaStartY - 22} ${cx + laaDrawW / 2 + 8},${laaStartY - 22} ${cx + laaDrawW / 2 + 24},${laaStartY - 10}" fill="none" stroke="#0284c7" stroke-width="2.2" stroke-dasharray="10,4,2,4" />
    <text x="${cx}" y="${laaStartY - 27}" text-anchor="middle" font-size="10" font-weight="700" fill="#0369a1">Upslope Stormwater Diversion Swale</text>

    <!-- LAA (ETA Beds OR Irrigation Zone) + Boreholes -->
    ${laaSvg}
    ${rbLabelOverlaySvg}
    <circle cx="${cx - laaDrawW / 2 - 20}" cy="${laaStartY + 14}" r="6" fill="#facc15" stroke="#713f12" stroke-width="1.5" />
    <text x="${cx - laaDrawW / 2 - 20}" y="${laaStartY + 2}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#713f12">BH1</text>
    <circle cx="${cx + laaDrawW / 2 + 20}" cy="${laaBottomY - 14}" r="6" fill="#facc15" stroke="#713f12" stroke-width="1.5" />
    <text x="${cx + laaDrawW / 2 + 20}" y="${laaBottomY + 4}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#713f12">BH2</text>

    <!-- Downslope Lomandra row -->
    <text x="${cx}" y="${vegY}" text-anchor="middle" font-size="10" font-weight="600" fill="#15803d">● ● ●  Downslope Buffer Planting: Lomandra hystrix (1.0 m offset)  ● ● ●</text>

    <!-- Reserve LAA -->
    <rect x="${cx - laaDrawW / 2}" y="${resY}" width="${laaDrawW}" height="${resH}" fill="#f1f5f9" stroke="#0f766e" stroke-width="1.6" stroke-dasharray="6,4" />
    <text x="${cx}" y="${resY + resH / 2 + 4}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#115e59">
      NOMINATED 100% ALTERNATE (RESERVE) LAA (${model.reserve_laa_m2} m²)
    </text>

    <!-- Slope indicator -->
    <g transform="translate(${W - 56}, ${laaStartY + 10})">
      <text x="0" y="-12" text-anchor="middle" font-size="10" font-weight="700" fill="#334155">FALL ${inp.site_eval?.slope_pct ?? 7}%</text>
      <text x="0" y="2" text-anchor="middle" font-size="9.5" fill="#52635c">(${escXml(inp.site_eval?.aspect ?? "SW")})</text>
      <line x1="0" y1="14" x2="0" y2="74" stroke="#334155" stroke-width="2" />
      <polygon points="0,82 -5,70 5,70" fill="#334155" />
    </g>

    <!-- Title Footer -->
    <rect x="14" y="${H - 44}" width="${W - 28}" height="34" fill="#f7f5ef" stroke="#143628" stroke-width="1.2" />
    <text x="24" y="${H - 23}" font-size="10.2" font-weight="700" fill="#143628">
      Field To Forest Environmental Consulting  |  Flow: ${model.total_flow_ld} L/d  |  LAA: ${model.required_laa_m2} m² (${escXml(model.limiting_factor)})  |  Ref: ${escXml(inp.project_ref)}${(inp.field_pins || []).some((p) => p.northing_mga56 && Math.abs(p.northing_mga56) > 1000) ? `  |  ${(inp.field_pins || []).length} MGA56 Pin(s)` : ""}
    </text>
  </svg>`;
}
