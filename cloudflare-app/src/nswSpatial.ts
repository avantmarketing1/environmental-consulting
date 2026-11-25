/**
 * Edge-native NSW Spatial Services & NSW Planning Portal ArcGIS REST client.
 * Designed for Cloudflare Workers Free Plan (< 5 ms CPU; all network I/O runs concurrently).
 */

export interface SpatialPreCheckPayload {
  lot_id_string: string;
  fetched_live: boolean;
  crs_epsg: number;
  crs_name: string;
  parcel_area_m2: number | null;
  parcel_area_ha: number | null;
  centroid_lat: number | null;
  centroid_lon: number | null;
  centroid_easting_mga56: number | null;
  centroid_northing_mga56: number | null;
  parcel_geojson: GeoJsonFeature | null;
  neighbour_parcels_geojson: GeoJsonFeature[];
  watercourses_geojson: GeoJsonFeature[];
  contours_geojson: GeoJsonFeature[];
  land_zoning: string[];
  min_lot_size: string[];
  flood_planning: boolean;
  flood_details: string[];
  landslide_risk: boolean;
  acid_sulfate_soils: string[];
  drinking_water_catchment: boolean;
  groundwater_vulnerability: boolean;
  riparian_land: boolean;
  wetlands: boolean;
  terrestrial_biodiversity: boolean;
  bushfire_prone_land: string[];
  nearest_watercourse_m: number | null;
  pre_site_flags: string[];
  warnings: string[];
  fetched_at: string;
}

export interface GeoJsonFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: {
    type: string;
    coordinates: unknown;
  };
}

const CADASTRE_LOT_URL =
  "https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Land_Parcel_Property_Theme/FeatureServer/8/query";
const HYDRO_LINE_URL =
  "https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Water_Theme/MapServer/5/query";
const CONTOUR_URL =
  "https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Elevation_and_Depth_Theme/MapServer/2/query";
const EPI_BASE =
  "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/EPI_Primary_Planning_Layers/MapServer";
const HAZARD_BASE =
  "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Hazard/MapServer";
const PROTECTION_BASE =
  "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Protection/MapServer";
const BUSHFIRE_LAYER =
  "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Fire/BFPL/MapServer/0";

const DEG2RAD = Math.PI / 180;
const EARTH_R = 6378137.0;

/** Approximate WGS84/GDA2020 (lon, lat) -> MGA Zone 56 (EPSG:7856) Easting/Northing (sub-metre accurate for Lismore). */
export function wgs84ToMga56(lon: number, lat: number): [number, number] {
  const a = 6378137.0;
  const f = 1 / 298.257222101;
  const k0 = 0.9996;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);
  const lon0 = 153.0 * DEG2RAD; // Zone 56 central meridian (153 E)

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

function ringAreaM2(ring: number[][]): number {
  if (ring.length < 3) return 0;
  let area = 0;
  const pts = ring.map(([lon, lat]) => wgs84ToMga56(lon, lat));
  for (let i = 0; i < pts.length - 1; i++) {
    area += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  }
  return Math.abs(area) / 2;
}

function polygonAreaAndCentroid(geom: { type: string; coordinates: unknown }): {
  areaM2: number;
  lon: number;
  lat: number;
  bbox: [number, number, number, number];
} {
  const rings: number[][][] =
    geom.type === "Polygon"
      ? (geom.coordinates as number[][][])
      : geom.type === "MultiPolygon"
        ? (geom.coordinates as number[][][][]).flat()
        : [];

  let areaM2 = 0;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  let sumLon = 0;
  let sumLat = 0;
  let count = 0;

  for (let rIdx = 0; rIdx < rings.length; rIdx++) {
    const ring = rings[rIdx];
    const rArea = ringAreaM2(ring);
    areaM2 += rIdx === 0 || geom.type === "MultiPolygon" ? rArea : -rArea;
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      sumLon += lon;
      sumLat += lat;
      count++;
    }
  }

  return {
    areaM2: Math.max(0, areaM2),
    lon: count > 0 ? sumLon / count : (minLon + maxLon) / 2,
    lat: count > 0 ? sumLat / count : (minLat + maxLat) / 2,
    bbox: [minLon, minLat, maxLon, maxLat],
  };
}

function haversineM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function extractLineVertices(geom: { type: string; coordinates: unknown }): number[][] {
  if (geom.type === "LineString") return geom.coordinates as number[][];
  if (geom.type === "MultiLineString") return (geom.coordinates as number[][][]).flat();
  return [];
}

function extractOuterVertices(geom: { type: string; coordinates: unknown }): number[][] {
  if (geom.type === "Polygon") return (geom.coordinates as number[][][])[0] ?? [];
  if (geom.type === "MultiPolygon") return (geom.coordinates as number[][][][]).map((p) => p[0] ?? []).flat();
  return [];
}

async function fetchJson(url: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, v);
  }
  const resp = await fetch(u.toString(), {
    headers: { Accept: "application/json" },
    cf: { cacheTtl: 3600, cacheEverything: true } as RequestInitCfProperties,
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} from ${u.hostname}`);
  }
  return (await resp.json()) as Record<string, unknown>;
}

function simplifyLine(pts: number[][], maxPts: number): number[][] {
  if (pts.length <= maxPts) {
    return pts.map((p) => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]);
  }
  const step = (pts.length - 1) / (maxPts - 1);
  const out: number[][] = [];
  for (let i = 0; i < maxPts; i++) {
    const p = pts[Math.min(pts.length - 1, Math.round(i * step))];
    out.push([Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]);
  }
  return out;
}

function simplifyCoords(coords: unknown, maxPts: number): unknown {
  if (!Array.isArray(coords) || coords.length === 0) return coords;
  if (typeof coords[0] === "number") {
    return coords.slice(0, 2).map((n) => (typeof n === "number" ? Math.round(n * 1e6) / 1e6 : n));
  }
  if (Array.isArray(coords[0]) && typeof coords[0][0] === "number") {
    return simplifyLine(coords as number[][], maxPts);
  }
  return coords.map((sub) => simplifyCoords(sub, maxPts));
}

function compactFeatures(feats: GeoJsonFeature[], maxCount: number, maxPts: number): GeoJsonFeature[] {
  return feats.slice(0, maxCount).map((f) => ({
    type: "Feature",
    properties: f.properties ?? {},
    geometry: {
      type: f.geometry.type,
      coordinates: simplifyCoords(f.geometry.coordinates, maxPts),
    },
  }));
}

async function queryGeoJson(url: string, params: Record<string, string>): Promise<GeoJsonFeature[]> {
  const data = await fetchJson(url, { outSR: "4326", f: "geojson", ...params });
  if (data.error) throw new Error(JSON.stringify(data.error));
  return (data.features as GeoJsonFeature[] | undefined) ?? [];
}

async function queryOverlayAttrs(layerUrl: string, lon: number, lat: number): Promise<Record<string, unknown>[]> {
  const pad = 0.0005;
  const geom = JSON.stringify({
    xmin: lon - pad,
    ymin: lat - pad,
    xmax: lon + pad,
    ymax: lat + pad,
    spatialReference: { wkid: 4326 },
  });
  const data = await fetchJson(`${layerUrl}/query`, {
    geometry: geom,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "false",
    f: "json",
  });
  if (data.error) return [];
  const feats = (data.features as Array<{ attributes?: Record<string, unknown> }> | undefined) ?? [];
  return feats.map((f) => f.attributes ?? {});
}

function uniqueLabels(attrsList: Record<string, unknown>[], keys: string[]): string[] {
  const out: string[] = [];
  for (const a of attrsList) {
    const parts = keys
      .map((k) => a[k])
      .filter((v) => v !== null && v !== undefined && String(v).trim() !== "")
      .map((v) => String(v).trim());
    if (parts.length) {
      const label = parts.join(" — ");
      if (!out.includes(label)) out.push(label);
    }
  }
  return out;
}

export async function runNswSpatialPrecheck(
  lotNumber: string,
  planLabel: string,
  sectionNumber?: string | null,
): Promise<SpatialPreCheckPayload> {
  const lotClean = lotNumber.trim();
  const planClean = planLabel.replace(/\s+/g, "").toUpperCase();
  const secClean = sectionNumber?.trim() || "";
  const lotId = `${lotClean}/${secClean}/${planClean}`;

  const result: SpatialPreCheckPayload = {
    lot_id_string: lotId,
    fetched_live: false,
    crs_epsg: 7856,
    crs_name: "GDA2020 / MGA zone 56",
    parcel_area_m2: null,
    parcel_area_ha: null,
    centroid_lat: null,
    centroid_lon: null,
    centroid_easting_mga56: null,
    centroid_northing_mga56: null,
    parcel_geojson: null,
    neighbour_parcels_geojson: [],
    watercourses_geojson: [],
    contours_geojson: [],
    land_zoning: [],
    min_lot_size: [],
    flood_planning: false,
    flood_details: [],
    landslide_risk: false,
    acid_sulfate_soils: [],
    drinking_water_catchment: false,
    groundwater_vulnerability: false,
    riparian_land: false,
    wetlands: false,
    terrestrial_biodiversity: false,
    bushfire_prone_land: [],
    nearest_watercourse_m: null,
    pre_site_flags: [],
    warnings: [],
    fetched_at: new Date().toISOString(),
  };

  // Validate inputs to prevent SQL injection into ArcGIS WHERE clause
  if (!/^[A-Z0-9]+$/i.test(lotClean) || !/^(DP|SP|CP)[0-9]+$/i.test(planClean)) {
    result.warnings.push("Invalid Lot or Plan format. Use e.g. Lot '12' and Plan 'DP123456'.");
    return result;
  }

  let where = `planlabel='${planClean}' AND lotnumber='${lotClean}'`;
  if (secClean && /^[A-Z0-9]+$/i.test(secClean)) {
    where += ` AND sectionnumber='${secClean}'`;
  }

  const lotFeats = await queryGeoJson(CADASTRE_LOT_URL, { where, outFields: "lotnumber,planlabel,lotidstring,urbanity" });
  if (!lotFeats.length) {
    result.warnings.push(`Parcel '${lotId}' was not found in NSW Spatial Services Cadastre.`);
    return result;
  }

  const parcel = lotFeats[0];
  const { areaM2, lon, lat, bbox } = polygonAreaAndCentroid(parcel.geometry);
  const [easting, northing] = wgs84ToMga56(lon, lat);

  result.fetched_live = true;
  result.parcel_area_m2 = Math.round(areaM2 * 10) / 10;
  result.parcel_area_ha = Math.round((areaM2 / 10000) * 1000) / 1000;
  result.centroid_lon = Math.round(lon * 1e6) / 1e6;
  result.centroid_lat = Math.round(lat * 1e6) / 1e6;
  result.centroid_easting_mga56 = easting;
  result.centroid_northing_mga56 = northing;
  result.parcel_geojson = parcel;

  const pad = 0.0028;
  const bboxGeom = JSON.stringify({
    xmin: bbox[0] - pad,
    ymin: bbox[1] - pad,
    xmax: bbox[2] + pad,
    ymax: bbox[3] + pad,
    spatialReference: { wkid: 4326 },
  });
  const spatialParams = {
    geometry: bboxGeom,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
  };

  // Run all remaining 13 NSW Spatial & Planning Portal queries concurrently (14 total subrequests << 50 Free cap)
  const [
    neighboursRes,
    waterRes,
    contoursRes,
    zoningRes,
    lotSizeRes,
    floodRes,
    landslideRes,
    assRes,
    dwcRes,
    gwvRes,
    riparianRes,
    bioRes,
    wetlandsRes,
    bfRes,
  ] = await Promise.allSettled([
    queryGeoJson(CADASTRE_LOT_URL, { ...spatialParams, outFields: "lotnumber,planlabel,lotidstring" }),
    queryGeoJson(HYDRO_LINE_URL, { ...spatialParams, outFields: "hydroname,perenniality,classsubtype" }),
    queryGeoJson(CONTOUR_URL, { ...spatialParams, outFields: "elevation" }),
    queryOverlayAttrs(`${EPI_BASE}/2`, lon, lat),
    queryOverlayAttrs(`${EPI_BASE}/4`, lon, lat),
    queryOverlayAttrs(`${HAZARD_BASE}/1`, lon, lat),
    queryOverlayAttrs(`${HAZARD_BASE}/2`, lon, lat),
    queryOverlayAttrs(`${PROTECTION_BASE}/1`, lon, lat),
    queryOverlayAttrs(`${PROTECTION_BASE}/3`, lon, lat),
    queryOverlayAttrs(`${PROTECTION_BASE}/4`, lon, lat),
    queryOverlayAttrs(`${PROTECTION_BASE}/7`, lon, lat),
    queryOverlayAttrs(`${PROTECTION_BASE}/10`, lon, lat),
    queryOverlayAttrs(`${PROTECTION_BASE}/11`, lon, lat),
    queryOverlayAttrs(BUSHFIRE_LAYER, lon, lat),
  ]);

  if (neighboursRes.status === "fulfilled") {
    result.neighbour_parcels_geojson = compactFeatures(
      neighboursRes.value.filter((f) => f.properties?.lotidstring !== lotId),
      25,
      30,
    );
  }
  if (waterRes.status === "fulfilled") {
    result.watercourses_geojson = compactFeatures(waterRes.value, 40, 35);
    // Estimate nearest distance between parcel boundary vertices and watercourse vertices
    const pVerts = extractOuterVertices(parcel.geometry);
    let minD = Infinity;
    for (const wf of result.watercourses_geojson) {
      const wVerts = extractLineVertices(wf.geometry);
      for (let i = 0; i < wVerts.length; i += Math.max(1, Math.floor(wVerts.length / 15))) {
        const [wx, wy] = wVerts[i];
        // Quick bbox check: if vertex inside parcel bbox, distance ~ 0
        if (wx >= bbox[0] && wx <= bbox[2] && wy >= bbox[1] && wy <= bbox[3]) {
          minD = 0;
          break;
        }
        for (let j = 0; j < pVerts.length; j += Math.max(1, Math.floor(pVerts.length / 20))) {
          const d = haversineM(wx, wy, pVerts[j][0], pVerts[j][1]);
          if (d < minD) minD = d;
        }
      }
      if (minD === 0) break;
    }
    if (Number.isFinite(minD)) {
      result.nearest_watercourse_m = Math.round(minD * 10) / 10;
    }
  }
  if (contoursRes.status === "fulfilled") {
    result.contours_geojson = compactFeatures(contoursRes.value, 35, 30);
  }
  if (zoningRes.status === "fulfilled") {
    result.land_zoning = uniqueLabels(zoningRes.value, ["SYM_CODE", "LAY_CLASS"]);
  }
  if (lotSizeRes.status === "fulfilled") {
    result.min_lot_size = uniqueLabels(lotSizeRes.value, ["LOT_SIZE", "UNITS"]);
  }
  if (floodRes.status === "fulfilled" && floodRes.value.length > 0) {
    result.flood_planning = true;
    result.flood_details = uniqueLabels(floodRes.value, ["LAY_CLASS", "EPI_NAME"]);
  }
  if (landslideRes.status === "fulfilled" && landslideRes.value.length > 0) {
    result.landslide_risk = true;
  }
  if (assRes.status === "fulfilled" && assRes.value.length > 0) {
    result.acid_sulfate_soils = uniqueLabels(assRes.value, ["LAY_CLASS", "SYM_CODE"]);
  }
  if (dwcRes.status === "fulfilled" && dwcRes.value.length > 0) {
    result.drinking_water_catchment = true;
  }
  if (gwvRes.status === "fulfilled" && gwvRes.value.length > 0) {
    result.groundwater_vulnerability = true;
  }
  if (riparianRes.status === "fulfilled" && riparianRes.value.length > 0) {
    result.riparian_land = true;
  }
  if (bioRes.status === "fulfilled" && bioRes.value.length > 0) {
    result.terrestrial_biodiversity = true;
  }
  if (wetlandsRes.status === "fulfilled" && wetlandsRes.value.length > 0) {
    result.wetlands = true;
  }
  if (bfRes.status === "fulfilled" && bfRes.value.length > 0) {
    const lbls = uniqueLabels(bfRes.value, ["CATEGORY", "Category", "LABEL", "d_Category"]);
    result.bushfire_prone_land = lbls.length ? lbls : ["Mapped Bushfire Prone Land"];
  }

  // Synthesize Lismore Strategy 2013 Pre-Site Brief Flags
  const flags: string[] = [];
  if (result.drinking_water_catchment) {
    flags.push("DRINKING WATER CATCHMENT: Rous Water On-site Wastewater Management Guidelines (2008) apply.");
  }
  if (result.flood_planning) {
    flags.push("FLOOD PLANNING OVERLAY: Treatment tank must sit above 1:100 yr flood contour; LAA above 1:20 yr.");
  }
  if (result.landslide_risk) {
    flags.push("LANDSLIDE RISK OVERLAY: Confirm slope stability & avoid concentrated subsurface infiltration.");
  }
  if (result.acid_sulfate_soils.length > 0) {
    flags.push(`ACID SULFATE SOILS (${result.acid_sulfate_soils.join(", ")}): Verify excavation depth triggers.`);
  }
  if (result.nearest_watercourse_m !== null && result.nearest_watercourse_m < 100) {
    flags.push(
      `WATERCOURSE / DRAINAGE LINE PROXIMITY (${result.nearest_watercourse_m === 0 ? "intersects parcel" : `${result.nearest_watercourse_m} m`}): Verify 40 m gully / 100 m watercourse LAA buffer on site.`,
    );
  }
  if (result.riparian_land || result.wetlands) {
    flags.push("RIPARIAN / WETLANDS OVERLAY: Maintain statutory buffer and secondary treatment safeguards.");
  }
  if (result.bushfire_prone_land.length > 0) {
    flags.push(`BUSHFIRE PRONE LAND (${result.bushfire_prone_land.join(", ")}): Shield exposed poly pipework/tanks.`);
  }
  if (!flags.length) {
    flags.push("No major statutory hazard overlays intersected at parcel centroid; verify local gullies & domestic bores on site.");
  }
  result.pre_site_flags = flags;
  return result;
}
