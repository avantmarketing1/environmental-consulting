"""Live NSW Spatial Services & NSW Planning Portal ArcGIS REST client.

Fetches official NSW Cadastre (Lot/DP), Neighbouring Lots, Watercourses, Elevation Contours,
Land Zoning, Lot Size, Flood, Landslide, Acid Sulfate Soils, Drinking Water Catchment,
Riparian/Wetlands/Biodiversity, and Bushfire Prone Land overlays, reprojected cleanly into
GDA2020 / MGA Zone 56 (EPSG:7856) for exact metric spatial analysis.
"""

from __future__ import annotations

import json
import math
from typing import Any

import httpx
from pyproj import Transformer
from shapely.geometry import mapping, shape
from shapely.ops import transform as shapely_transform

from enviro_comply.schemas.ossm import SpatialPreCheckResult

CADASTRE_LOT_URL = (
    "https://portal.spatial.nsw.gov.au/server/rest/services/"
    "NSW_Land_Parcel_Property_Theme/FeatureServer/8/query"
)
HYDRO_LINE_URL = (
    "https://portal.spatial.nsw.gov.au/server/rest/services/"
    "NSW_Water_Theme/MapServer/5/query"
)
NAMED_WATERCOURSE_URL = (
    "https://portal.spatial.nsw.gov.au/server/rest/services/"
    "NSW_Water_Theme/MapServer/2/query"
)
CONTOUR_URL = (
    "https://portal.spatial.nsw.gov.au/server/rest/services/"
    "NSW_Elevation_and_Depth_Theme/MapServer/2/query"
)
EPI_BASE = "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/EPI_Primary_Planning_Layers/MapServer"
HAZARD_BASE = "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Hazard/MapServer"
PROTECTION_BASE = "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Protection/MapServer"
BUSHFIRE_URL = "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Fire/BFPL/MapServer/0/query"

_TO_MGA56 = Transformer.from_crs("EPSG:4326", "EPSG:7856", always_xy=True).transform
_TO_WGS84 = Transformer.from_crs("EPSG:7856", "EPSG:4326", always_xy=True).transform


def _format_lot_id(lot_number: str, plan_label: str, section_number: str | None = None) -> str:
    sec = section_number.strip() if section_number else ""
    return f"{lot_number.strip()}/{sec}/{plan_label.replace(' ', '').upper()}"


def _query_geojson(client: httpx.Client, url: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    q = dict(params)
    q.setdefault("outSR", "4326")
    q.setdefault("f", "geojson")
    resp = client.get(url, params=q)
    resp.raise_for_status()
    data = resp.json()
    if "error" in data:
        raise RuntimeError(f"ArcGIS error from {url}: {data['error']}")
    return data.get("features", [])


def _query_attributes_at_point(
    client: httpx.Client,
    layer_url: str,
    lon: float,
    lat: float,
    buffer_deg: float = 0.0001,
) -> list[dict[str, Any]]:
    geom = json.dumps(
        {
            "xmin": lon - buffer_deg,
            "ymin": lat - buffer_deg,
            "xmax": lon + buffer_deg,
            "ymax": lat + buffer_deg,
            "spatialReference": {"wkid": 4326},
        }
    )
    resp = client.get(
        f"{layer_url}/query",
        params={
            "geometry": geom,
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "*",
            "returnGeometry": "false",
            "f": "json",
        },
    )
    resp.raise_for_status()
    data = resp.json()
    if "error" in data:
        return []
    return [f.get("attributes", {}) for f in data.get("features", [])]


def _extract_unique_labels(attrs_list: list[dict[str, Any]], keys: list[str]) -> list[str]:
    out: list[str] = []
    for a in attrs_list:
        parts = [str(a[k]).strip() for k in keys if a.get(k) not in (None, "", " ")]
        if parts:
            lbl = " — ".join(parts)
            if lbl not in out:
                out.append(lbl)
    return out


def run_spatial_precheck(
    lot_number: str,
    plan_label: str,
    section_number: str | None = None,
    timeout_s: float = 20.0,
    offline: bool = False,
) -> SpatialPreCheckResult:
    """Query live NSW Spatial Services & Planning Portal layers for a Lot/DP."""
    plan_clean = plan_label.replace(" ", "").upper()
    lot_clean = str(lot_number).strip()
    lot_id = _format_lot_id(lot_clean, plan_clean, section_number)

    result = SpatialPreCheckResult(lot_id_string=lot_id)
    if offline:
        result.warnings.append("Spatial pre-check executed in offline mode; live NSW GIS layers were not queried.")
        return result

    try:
        with httpx.Client(timeout=timeout_s, follow_redirects=True) as client:
            where = f"planlabel='{plan_clean}' AND lotnumber='{lot_clean}'"
            if section_number:
                where += f" AND sectionnumber='{section_number.strip()}'"

            feats = _query_geojson(client, CADASTRE_LOT_URL, {"where": where, "outFields": "*"})
            if not feats:
                result.warnings.append(f"Cadastre parcel '{lot_id}' was not found in NSW Spatial Services Lot layer.")
                return result

            parcel_wgs = shape(feats[0]["geometry"])
            parcel_mga = shapely_transform(_TO_MGA56, parcel_wgs)
            centroid_mga = parcel_mga.centroid
            centroid_wgs = shapely_transform(_TO_WGS84, centroid_mga)

            result.fetched_live = True
            result.parcel_area_m2 = round(float(parcel_mga.area), 1)
            result.parcel_area_ha = round(float(parcel_mga.area) / 10_000.0, 3)
            result.centroid_lon = round(float(centroid_wgs.x), 6)
            result.centroid_lat = round(float(centroid_wgs.y), 6)
            result.centroid_easting_mga56 = round(float(centroid_mga.x), 2)
            result.centroid_northing_mga56 = round(float(centroid_mga.y), 2)
            result.parcel_geometry_mga56 = {
                "type": "Feature",
                "properties": {"lotidstring": lot_id, "lotnumber": lot_clean, "planlabel": plan_clean},
                "geometry": mapping(parcel_mga),
            }

            # Bounding box in WGS84 expanded by ~300 m (~0.003 deg) for neighbours, watercourses, contours
            minx, miny, maxx, maxy = parcel_wgs.bounds
            pad = 0.003
            bbox_geom = json.dumps(
                {
                    "xmin": minx - pad,
                    "ymin": miny - pad,
                    "xmax": maxx + pad,
                    "ymax": maxy + pad,
                    "spatialReference": {"wkid": 4326},
                }
            )
            spatial_params = {
                "geometry": bbox_geom,
                "geometryType": "esriGeometryEnvelope",
                "inSR": "4326",
                "spatialRel": "esriSpatialRelIntersects",
                "outFields": "*",
            }

            # Neighbouring parcels
            try:
                nb_feats = _query_geojson(client, CADASTRE_LOT_URL, {**spatial_params, "outFields": "lotnumber,planlabel,lotidstring"})
                for nf in nb_feats[:40]:
                    props = nf.get("properties", {})
                    if props.get("lotidstring") == lot_id:
                        continue
                    g_mga = shapely_transform(_TO_MGA56, shape(nf["geometry"]))
                    result.neighbour_parcels_mga56.append(
                        {"type": "Feature", "properties": props, "geometry": mapping(g_mga)}
                    )
            except Exception as exc:
                result.warnings.append(f"Neighbouring cadastre query skipped: {exc}")

            # Watercourses (HydroLine)
            try:
                wc_feats = _query_geojson(client, HYDRO_LINE_URL, {**spatial_params, "outFields": "hydroname,perenniality,classsubtype"})
                min_dist = math.inf
                for wf in wc_feats[:80]:
                    g_mga = shapely_transform(_TO_MGA56, shape(wf["geometry"]))
                    d = float(parcel_mga.distance(g_mga))
                    if d < min_dist:
                        min_dist = d
                    result.watercourses_mga56.append(
                        {"type": "Feature", "properties": wf.get("properties", {}), "geometry": mapping(g_mga)}
                    )
                if math.isfinite(min_dist):
                    result.nearest_watercourse_m = round(min_dist, 1)
            except Exception as exc:
                result.warnings.append(f"Watercourse query skipped: {exc}")

            # Elevation Contours
            try:
                c_feats = _query_geojson(client, CONTOUR_URL, {**spatial_params, "outFields": "elevation,classsubtype"})
                elevs_in_parcel: list[float] = []
                for cf in c_feats[:150]:
                    g_mga = shapely_transform(_TO_MGA56, shape(cf["geometry"]))
                    props = cf.get("properties", {})
                    result.contours_mga56.append(
                        {"type": "Feature", "properties": props, "geometry": mapping(g_mga)}
                    )
                    if g_mga.intersects(parcel_mga) and props.get("elevation") is not None:
                        elevs_in_parcel.append(float(props["elevation"]))
                if len(elevs_in_parcel) >= 2:
                    elev_span = max(elevs_in_parcel) - min(elevs_in_parcel)
                    px1, py1, px2, py2 = parcel_mga.bounds
                    diag = math.hypot(px2 - px1, py2 - py1)
                    if diag > 10.0:
                        result.estimated_slope_pct = round(100.0 * elev_span / (diag * 0.7), 1)
            except Exception as exc:
                result.warnings.append(f"Contour query skipped: {exc}")

            # Planning Overlays at parcel centroid (and parcel envelope)
            cx, cy = float(centroid_wgs.x), float(centroid_wgs.y)
            overlay_specs = [
                (f"{EPI_BASE}/2", "zoning", ["SYM_CODE", "LAY_CLASS"]),
                (f"{EPI_BASE}/4", "lot_size", ["LOT_SIZE", "UNITS"]),
                (f"{HAZARD_BASE}/1", "flood", ["LAY_CLASS", "EPI_NAME"]),
                (f"{HAZARD_BASE}/2", "landslide", ["LAY_CLASS", "EPI_NAME"]),
                (f"{PROTECTION_BASE}/1", "ass", ["LAY_CLASS", "SYM_CODE"]),
                (f"{PROTECTION_BASE}/3", "dwc", ["LAY_CLASS", "EPI_NAME"]),
                (f"{PROTECTION_BASE}/4", "gwv", ["LAY_CLASS"]),
                (f"{PROTECTION_BASE}/7", "riparian", ["LAY_CLASS"]),
                (f"{PROTECTION_BASE}/10", "biodiversity", ["LAY_CLASS"]),
                (f"{PROTECTION_BASE}/11", "wetlands", ["LAY_CLASS"]),
            ]

            for url, tag, keys in overlay_specs:
                try:
                    attrs = _query_attributes_at_point(client, url, cx, cy, buffer_deg=0.0005)
                    labels = _extract_unique_labels(attrs, keys)
                    if tag == "zoning":
                        result.land_zoning = labels
                    elif tag == "lot_size":
                        result.min_lot_size = labels
                    elif tag == "flood" and attrs:
                        result.flood_planning = True
                        result.flood_details = labels or ["Mapped Flood Planning Area"]
                    elif tag == "landslide" and attrs:
                        result.landslide_risk = True
                    elif tag == "ass" and attrs:
                        result.acid_sulfate_soils = labels or ["Mapped Acid Sulfate Soil Risk"]
                    elif tag == "dwc" and attrs:
                        result.drinking_water_catchment = True
                    elif tag == "gwv" and attrs:
                        result.groundwater_vulnerability = True
                    elif tag == "riparian" and attrs:
                        result.riparian_land = True
                    elif tag == "biodiversity" and attrs:
                        result.terrestrial_biodiversity = True
                    elif tag == "wetlands" and attrs:
                        result.wetlands = True
                except Exception as exc:
                    result.warnings.append(f"Overlay '{tag}' query skipped: {exc}")

            # Bushfire Prone Land
            try:
                bf_attrs = _query_attributes_at_point(
                    client,
                    "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Fire/BFPL/MapServer/0",
                    cx,
                    cy,
                    buffer_deg=0.0005,
                )
                result.bushfire_prone_land = _extract_unique_labels(bf_attrs, ["CATEGORY", "Category", "LABEL", "d_Category"])
                if bf_attrs and not result.bushfire_prone_land:
                    result.bushfire_prone_land = ["Mapped Bushfire Prone Land"]
            except Exception as exc:
                result.warnings.append(f"Bushfire overlay query skipped: {exc}")

    except Exception as exc:
        result.warnings.append(f"Live NSW GIS pre-check failed ({type(exc).__name__}: {exc}).")

    # Synthesize Pre-Site Brief Flags
    flags: list[str] = []
    if result.drinking_water_catchment:
        flags.append("DRINKING WATER CATCHMENT: Rous Water On-site Wastewater Management Guidelines (2008) apply.")
    if result.flood_planning:
        flags.append("FLOOD PLANNING AREA: Treatment system must sit above 1:100 yr flood level; LAA above 1:20 yr.")
    if result.landslide_risk:
        flags.append("LANDSLIDE RISK OVERLAY: Confirm slope stability & avoid concentrated effluent infiltration.")
    if result.acid_sulfate_soils:
        flags.append(f"ACID SULFATE SOILS ({', '.join(result.acid_sulfate_soils)}): Check excavation depth triggers.")
    if result.nearest_watercourse_m is not None and result.nearest_watercourse_m < 100.0:
        flags.append(
            f"WATERCOURSE PROXIMITY: Mapped drainage line is {result.nearest_watercourse_m:.1f} m from parcel — "
            "verify 40 m (gully) / 100 m (intermittent/perennial) LAA buffer on site."
        )
    if result.riparian_land or result.wetlands:
        flags.append("RIPARIAN / WETLANDS OVERLAY: Maintain full statutory setback from mapped riparian corridor.")
    if result.bushfire_prone_land:
        flags.append(f"BUSHFIRE PRONE LAND ({', '.join(result.bushfire_prone_land)}): Protect exposed poly tanks/pipework.")
    if not flags and result.fetched_live:
        flags.append("No major statutory hazard overlays intersected at parcel centroid; verify local gullies & bores on site.")
    result.pre_site_flags = flags
    return result
