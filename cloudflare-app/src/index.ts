import { Hono } from "hono";
import {
  buildLogoutCookieHeader,
  buildSafeFileResponseHeaders,
  buildSessionCookieHeader,
  checkRateLimit,
  createSignedSessionToken,
  extractCookie,
  isAdminProtectedPath,
  isLocalhostUrl,
  renderAdminLoginHtml,
  SESSION_COOKIE_NAME,
  verifyAdminPassword,
  verifyCloudflareAccessJwt,
  verifySignedSessionToken,
} from "./auth";
import {
  DEFAULT_GEMINI_MODEL,
  draftCustomReportNarrativesWithGemini,
  draftCustomSeeNarrativesWithGemini,
  extractStructuredAssessmentWithGemini,
  type GeminiFilePart,
} from "./gemini";
import { runNswSpatialPrecheck } from "./nswSpatial";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  FILES: R2Bucket;
  BRAND_NAME: string;
  SITE_URL: string;
  BASE_PATH: string;
  DEFAULT_LGA: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
  TRUST_CF_ACCESS?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
}

const app = new Hono<{ Bindings: Env }>();

// Always return JSON for API errors so clients never fail parsing plain-text error pages
app.onError((err, c) => {
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: message || "Internal server error" }, 500);
});

// ============================================================================
// SECURITY HEADERS & ADMIN AUTHENTICATION GUARD (DEFENSE IN DEPTH)
// ============================================================================
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  const path = url.pathname;
  const isHttps = url.protocol === "https:";
  const isLocal = isLocalhostUrl(c.req.url);
  const adminPassword = (c.env.ADMIN_PASSWORD || "").trim();
  const signingSecret = (c.env.SESSION_SECRET || adminPassword).trim();

  if (isAdminProtectedPath(c.req.method, path)) {
    const isApiOrAsset = path.startsWith("/consulting/api/") || path.startsWith("/consulting/py/");

    if (!adminPassword) {
      // Fail CLOSED in production if ADMIN_PASSWORD secret hasn't been configured yet!
      if (!isLocal) {
        if (isApiOrAsset) {
          return c.json(
            { error: "Admin authentication is not configured. Set ADMIN_PASSWORD via `npx wrangler secret put ADMIN_PASSWORD`." },
            503,
          );
        }
        return c.html(
          "<h1>503 — Admin Auth Not Configured</h1><p>Run <code>npx wrangler secret put ADMIN_PASSWORD</code> in <code>cloudflare-app/</code> before accessing the private studio in production.</p>",
          503,
        );
      }
      // On localhost without ADMIN_PASSWORD in .dev.vars, allow frictionless local development
    } else {
      const token = extractCookie(c.req.header("cookie"), SESSION_COOKIE_NAME);
      const validCookie = token ? await verifySignedSessionToken(token, signingSecret) : false;

      let validAccessJwt = false;
      if (!validCookie && c.env.TRUST_CF_ACCESS === "true") {
        const accessRes = await verifyCloudflareAccessJwt(
          c.req.header("cf-access-jwt-assertion"),
          c.env.CF_ACCESS_TEAM_DOMAIN,
          c.env.CF_ACCESS_AUD,
        );
        validAccessJwt = accessRes.valid;
      }

      if (!validCookie && !validAccessJwt) {
        if (isApiOrAsset) {
          return c.json({ error: "Unauthorized — Consultant sign-in required." }, 401);
        }
        const loginUrl = `/consulting/admin-login?next=${encodeURIComponent(path)}`;
        return c.redirect(loginUrl, 302);
      }
    }
  }

  await next();

  // Attach strict security headers to every response
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(self)");
  if (isHttps) {
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  if (
    path.startsWith("/consulting/app") ||
    path.startsWith("/consulting/admin-login") ||
    path.startsWith("/consulting/py/") ||
    path.startsWith("/consulting/api/")
  ) {
    c.header("X-Robots-Tag", "noindex, nofollow");
  }
});

// Admin Login & Session Routes
app.get("/consulting/admin-login", (c) => {
  const next = c.req.query("next") || "/consulting/app/";
  return c.html(renderAdminLoginHtml(next), 200, {
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  });
});

app.get("/consulting/api/auth/session", async (c) => {
  const adminPassword = (c.env.ADMIN_PASSWORD || "").trim();
  const signingSecret = (c.env.SESSION_SECRET || adminPassword).trim();
  const token = extractCookie(c.req.header("cookie"), SESSION_COOKIE_NAME);
  const authenticated = adminPassword ? (token ? await verifySignedSessionToken(token, signingSecret) : false) : isLocalhostUrl(c.req.url);
  return c.json({
    auth_enabled: Boolean(adminPassword),
    authenticated,
  });
});

app.post("/consulting/api/auth/login", async (c) => {
  const adminPassword = (c.env.ADMIN_PASSWORD || "").trim();
  if (!adminPassword) {
    return c.json({ error: "ADMIN_PASSWORD is not configured on this Worker." }, 503);
  }

  const clientIp = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "local";
  const rl = checkRateLimit(`login:${clientIp}`, 8, 15 * 60 * 1000);
  if (!rl.allowed) {
    return c.json(
      { error: `Too many sign-in attempts. Try again in ${rl.retryAfterSec} seconds.` },
      429,
      { "Retry-After": String(rl.retryAfterSec) },
    );
  }

  const body = await c.req.json<{ password?: string }>().catch(() => ({ password: "" }));
  const ok = await verifyAdminPassword(String(body.password || ""), adminPassword);
  if (!ok) {
    await new Promise((r) => setTimeout(r, 450));
    return c.json({ error: "Invalid administrator password." }, 401);
  }

  const signingSecret = (c.env.SESSION_SECRET || adminPassword).trim();
  const token = await createSignedSessionToken(signingSecret);
  const isHttps = new URL(c.req.url).protocol === "https:";
  c.header("Set-Cookie", buildSessionCookieHeader(token, isHttps));
  return c.json({ ok: true });
});

app.post("/consulting/api/auth/logout", (c) => {
  const isHttps = new URL(c.req.url).protocol === "https:";
  c.header("Set-Cookie", buildLogoutCookieHeader(isHttps));
  return c.json({ ok: true });
});

/** Downsample GeoJSON coordinate arrays so D1 bound parameters stay well under D1's size limit (< 80 KB). */
function thinCoords(coords: unknown, maxPts: number): unknown {
  if (!Array.isArray(coords) || coords.length === 0) return coords;
  if (typeof coords[0] === "number") {
    return coords.slice(0, 2).map((n) => (typeof n === "number" ? Math.round(n * 1e6) / 1e6 : n));
  }
  if (Array.isArray(coords[0]) && typeof coords[0][0] === "number") {
    const pts = coords as number[][];
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
  return coords.map((sub) => thinCoords(sub, maxPts));
}

function thinFeatures(feats: unknown, maxCount: number, maxPts: number): unknown[] {
  if (!Array.isArray(feats)) return [];
  return feats.slice(0, maxCount).map((f) => {
    const feat = f as Record<string, unknown>;
    const geom = feat?.geometry as Record<string, unknown> | undefined;
    return {
      type: "Feature",
      properties: feat?.properties ?? {},
      geometry: geom ? { type: geom.type, coordinates: thinCoords(geom.coordinates, maxPts) } : null,
    };
  });
}

function compactSpatialForD1(spatial: unknown): string | null {
  if (!spatial || typeof spatial !== "object") return null;
  const s = { ...(spatial as Record<string, unknown>) };
  if (s.parcel_geojson && typeof s.parcel_geojson === "object") {
    s.parcel_geojson = thinFeatures([s.parcel_geojson], 1, 100)[0];
  }
  s.neighbour_parcels_geojson = thinFeatures(s.neighbour_parcels_geojson, 25, 36);
  s.watercourses_geojson = thinFeatures(s.watercourses_geojson, 45, 70);
  s.contours_geojson = thinFeatures(s.contours_geojson, 100, 70);

  let json = JSON.stringify(s);
  if (json.length > 180_000) {
    s.contours_geojson = thinFeatures(s.contours_geojson, 55, 45);
    json = JSON.stringify(s);
  }
  if (json.length > 180_000) {
    s.contours_geojson = [];
    json = JSON.stringify(s);
  }
  if (json.length > 180_000) {
    s.neighbour_parcels_geojson = [];
    json = JSON.stringify(s);
  }
  if (json.length > 180_000) {
    s.watercourses_geojson = [];
    json = JSON.stringify(s);
  }
  return json;
}

// During local dev, redirect bare root `/` -> `/consulting/` so preview opens cleanly
app.get("/", (c) => c.redirect("/consulting/", 302));
app.get("/consulting", (c) => c.redirect("/consulting/", 301));
app.get("/consulting/app", (c) => c.redirect("/consulting/app/", 301));

// ============================================================================
// API ROUTES (/consulting/api/*) — Thin TypeScript Edge Worker (< 10 ms CPU)
// ============================================================================

app.get("/consulting/api/health", (c) => {
  return c.json({
    status: "ok",
    brand: c.env.BRAND_NAME || "Field To Forest",
    lga: c.env.DEFAULT_LGA || "Lismore City Council",
    runtime: "cloudflare-workers-free",
    pyodide_mode: "client-web-worker-offline-pwa",
  });
});

// Live NSW Spatial Services & NSW Planning Portal GIS Pre-Check
app.get("/consulting/api/spatial/precheck", async (c) => {
  const clientIp = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "local";
  const rl = checkRateLimit(`gis:${clientIp}`, 30, 60 * 1000);
  if (!rl.allowed) {
    return c.json({ error: "Rate limit exceeded. Please wait a moment before running another lookup." }, 429, {
      "Retry-After": String(rl.retryAfterSec),
    });
  }

  const lot = c.req.query("lot")?.trim();
  const plan = c.req.query("plan")?.trim();
  const section = c.req.query("section")?.trim() || null;

  if (!lot || !plan) {
    return c.json({ error: "Query parameters 'lot' and 'plan' are required (e.g. ?lot=12&plan=DP123456)." }, 400);
  }

  try {
    const result = await runNswSpatialPrecheck(lot, plan, section);
    return c.json(result, 200, {
      "Cache-Control": "public, max-age=1800",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: "Spatial pre-check failed", detail: message }, 502);
  }
});

// ============================================================================
// ENQUIRIES (Public Quote Requests from fieldtoforestfarm.com/consulting/)
// ============================================================================

app.get("/consulting/api/enquiries", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM enquiries ORDER BY created_at DESC LIMIT 100",
  ).all();
  return c.json({ enquiries: results ?? [] });
});

app.post("/consulting/api/enquiries", async (c) => {
  const clientIp = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "local";
  const rl = checkRateLimit(`enq:${clientIp}`, 8, 15 * 60 * 1000);
  if (!rl.allowed) {
    return c.json({ error: "Too many quote submissions. Please wait a few minutes and try again." }, 429, {
      "Retry-After": String(rl.retryAfterSec),
    });
  }

  const body = await c.req.json<Record<string, unknown>>();
  const fullName = String(body.full_name ?? "").trim();
  const email = String(body.email ?? "").trim();

  if (!fullName || !email || !email.includes("@")) {
    return c.json({ error: "Valid 'full_name' and 'email' are required." }, 400);
  }

  const id = crypto.randomUUID();
  const phone = body.phone ? String(body.phone).trim() : null;
  const siteAddress = body.site_address ? String(body.site_address).trim() : null;
  const lotNumber = body.lot_number ? String(body.lot_number).trim() : null;
  const planLabel = body.plan_label ? String(body.plan_label).replace(/\s+/g, "").toUpperCase() : null;
  const serviceType = String(body.service_type ?? "ossm_s68").trim();
  const bedrooms = body.bedrooms ? Number(body.bedrooms) : null;
  const notes = body.notes ? String(body.notes).trim() : null;
  const spatialJson = compactSpatialForD1(body.spatial_precheck);

  await c.env.DB.prepare(
    `INSERT INTO enquiries (id, full_name, email, phone, site_address, lot_number, plan_label, service_type, bedrooms, notes, spatial_precheck_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, fullName, email, phone, siteAddress, lotNumber, planLabel, serviceType, bedrooms, notes, spatialJson)
    .run();

  return c.json({ id, status: "new", message: "Enquiry received by Field To Forest Environmental Consulting." }, 201);
});

app.post("/consulting/api/enquiries/:id/convert", async (c) => {
  const enquiryId = c.req.param("id");
  const enq = await c.env.DB.prepare("SELECT * FROM enquiries WHERE id = ?").bind(enquiryId).first<Record<string, unknown>>();
  if (!enq) {
    return c.json({ error: "Enquiry not found" }, 404);
  }

  const jobId = crypto.randomUUID();
  const shortCode = jobId.slice(0, 6).toUpperCase();
  const projectRef = `FTF-${new Date().getUTCFullYear()}-${shortCode}`;
  const lotNum = String(enq.lot_number ?? "1");
  const planLbl = String(enq.plan_label ?? "DP000000");
  const applicantName = String(enq.full_name ?? "Client");
  const siteAddress = String(enq.site_address ?? `Lot ${lotNum} ${planLbl}, Lismore NSW`);
  const bedrooms = Number(enq.bedrooms ?? 3);

  const initialAssessment = {
    project_ref: projectRef,
    applicant_name: applicantName,
    site_address: siteAddress,
    lot_number: lotNum,
    plan_label: planLbl,
    lga: "Lismore City Council",
    is_multiple_occupancy: false,
    block_size_m2: 10000,
    development_description: "Combined Secondary On-Site Wastewater Treatment and Disposal System",
    bedrooms,
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
      assessment_date: new Date().toISOString().slice(0, 10),
      recent_weather: "Dry with intermittent showers",
      existing_system_notes: enq.notes ? String(enq.notes) : "",
      existing_vegetation: "Mixed grass cover and scattered trees",
      slope_pct: 6.0,
      slope_range_text: "5-7%",
      landform: "linear_planar",
      landform_notes: "Linear planar slope across proposed LAA",
      aspect: "North-East",
      exposure: "high",
      boulders_rocks: "None encountered",
      boulders_limiting: false,
      flooding_potential: "None (above 1:20 and 1:100 year flood levels)",
      below_1_in_20_flood: false,
      below_1_in_100_flood: false,
      site_drainage: "Good; no surface dampness observed",
      surface_dampness: false,
      waterlogging_vegetation: "No sedges observed",
      waterlogging_present: false,
      surface_condition: "Grassed; no cracking or ponding",
      surface_cracking_or_bare: false,
      fill_notes: "None",
      contains_fill: false,
      erosion_notes: "No rills, slips, or cracks observed",
      erosion_present: false,
      depth_to_water_table_m: 3.0,
      run_on_diversion_proposed: "Construct upslope run-on diversion swale above LAA",
      run_off_control_proposed: "Plant double row of Lomandra hystrix (1.0 m offset) downslope of ETA bed",
      reserve_laa_available: true,
      dist_perennial_watercourse_m: 150,
      dist_gully_m: 45,
      dist_domestic_bore_m: 300,
      dist_property_boundary_m: 20,
      boundary_is_downgradient: true,
      dist_dwelling_m: 15,
      septic_to_dwelling_m: 4.5,
      dist_nearest_small_tree_m: 6,
    },
    boreholes: [
      {
        borehole_id: "BH1 (Upper LAA)",
        bolus_ribbon_mm: "40-50 mm",
        bolus_description: "Plastic clay loam / strongly structured light clay",
        depth_to_bedrock_m: 3.0,
        depth_to_water_table_m: 3.0,
        horizons: [
          { horizon: "A", depth_top_mm: 0, depth_bottom_mm: 150, classification: "Topsoil", texture_moist: "loamy", structure_moist: "moderate", colour: "Dark brown", coarse_fragments_pct: 5, ph: 6.0, dispersive_class: 2, is_disposal_level: false },
          { horizon: "B", depth_top_mm: 150, depth_bottom_mm: 1000, classification: "Clay loam / light clay", texture_moist: "subplastic", structure_moist: "strong", colour: "Red-brown", coarse_fragments_pct: 5, ph: 6.0, dispersive_class: 2, is_disposal_level: true },
        ],
      },
      {
        borehole_id: "BH2 (Lower LAA)",
        bolus_ribbon_mm: "40-50 mm",
        bolus_description: "Consistent profile across lower LAA",
        depth_to_bedrock_m: 3.0,
        depth_to_water_table_m: 3.0,
        horizons: [
          { horizon: "A", depth_top_mm: 0, depth_bottom_mm: 150, classification: "Topsoil", texture_moist: "loamy", structure_moist: "moderate", colour: "Dark brown", coarse_fragments_pct: 5, ph: 6.0, dispersive_class: 2, is_disposal_level: false },
          { horizon: "B", depth_top_mm: 150, depth_bottom_mm: 1000, classification: "Clay loam / light clay", texture_moist: "subplastic", structure_moist: "strong", colour: "Red-brown", coarse_fragments_pct: 5, ph: 6.0, dispersive_class: 2, is_disposal_level: true },
        ],
      },
    ],
    consultant: {
      name: "Field To Forest Environmental Consulting",
      qualification: "Accredited Wastewater Consultant (Northern Rivers NSW)",
      licence_number: "FTF-NSW",
      company: "Field To Forest",
      phone: "",
      email: "consulting@fieldtoforestfarm.com",
      postal_address: "Lismore NSW 2480",
    },
  };

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO jobs (id, project_ref, status, applicant_name, site_address, lot_number, plan_label, lga, assessment_json, spatial_json)
       VALUES (?, ?, 'precheck', ?, ?, ?, ?, 'Lismore City Council', ?, ?)`,
    ).bind(
      jobId,
      projectRef,
      applicantName,
      siteAddress,
      lotNum,
      planLbl,
      JSON.stringify(initialAssessment),
      enq.spatial_precheck_json ? String(enq.spatial_precheck_json) : null,
    ),
    c.env.DB.prepare("UPDATE enquiries SET status = 'converted', converted_job_id = ? WHERE id = ?").bind(jobId, enquiryId),
  ]);

  return c.json({ job_id: jobId, project_ref: projectRef }, 201);
});

// ============================================================================
// JOBS CRUD (Cloudflare D1)
// ============================================================================

app.get("/consulting/api/jobs", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, project_ref, created_at, updated_at, status, applicant_name, site_address, lot_number, plan_label, lga FROM jobs ORDER BY updated_at DESC LIMIT 100",
  ).all();
  return c.json({ jobs: results ?? [] });
});

app.get("/consulting/api/jobs/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!row) return c.json({ error: "Job not found" }, 404);

  const { results: files } = await c.env.DB.prepare(
    "SELECT * FROM job_files WHERE job_id = ? ORDER BY created_at DESC",
  ).bind(id).all();

  return c.json({
    ...row,
    assessment: JSON.parse(String(row.assessment_json)),
    spatial: row.spatial_json ? JSON.parse(String(row.spatial_json)) : null,
    model_result: row.model_result_json ? JSON.parse(String(row.model_result_json)) : null,
    audit_result: row.audit_result_json ? JSON.parse(String(row.audit_result_json)) : null,
    files: files ?? [],
  });
});

app.post("/consulting/api/jobs", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const assessment = (body.assessment ?? body) as Record<string, unknown>;
  const id = crypto.randomUUID();
  const projectRef = String(assessment.project_ref ?? `FTF-${new Date().getUTCFullYear()}-${id.slice(0, 6).toUpperCase()}`);
  assessment.project_ref = projectRef;

  const applicantName = String(assessment.applicant_name ?? "Unnamed Client").trim();
  const siteAddress = String(assessment.site_address ?? "Lismore NSW 2480").trim();
  const lotNumber = String(assessment.lot_number ?? "1").trim();
  const planLabel = String(assessment.plan_label ?? "DP000000").replace(/\s+/g, "").toUpperCase();
  const lga = String(assessment.lga ?? "Lismore City Council").trim();
  const status = String(body.status ?? "precheck");
  const compactSpatial = compactSpatialForD1(body.spatial);

  // If a job with the same project_ref already exists, update it cleanly instead of failing UNIQUE constraint
  const existing = await c.env.DB.prepare("SELECT id FROM jobs WHERE project_ref = ?")
    .bind(projectRef)
    .first<{ id: string }>();

  if (existing?.id) {
    await c.env.DB.prepare(
      `UPDATE jobs
       SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           status = ?,
           applicant_name = ?,
           site_address = ?,
           lot_number = ?,
           plan_label = ?,
           lga = ?,
           assessment_json = ?,
           spatial_json = COALESCE(?, spatial_json),
           model_result_json = COALESCE(?, model_result_json),
           audit_result_json = COALESCE(?, audit_result_json)
       WHERE id = ?`,
    )
      .bind(
        status,
        applicantName,
        siteAddress,
        lotNumber,
        planLabel,
        lga,
        JSON.stringify(assessment),
        compactSpatial,
        body.model_result ? JSON.stringify(body.model_result) : null,
        body.audit_result ? JSON.stringify(body.audit_result) : null,
        existing.id,
      )
      .run();

    return c.json({ id: existing.id, project_ref: projectRef, status, updated: true }, 200);
  }

  await c.env.DB.prepare(
    `INSERT INTO jobs (id, project_ref, status, applicant_name, site_address, lot_number, plan_label, lga, assessment_json, spatial_json, model_result_json, audit_result_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      projectRef,
      status,
      applicantName,
      siteAddress,
      lotNumber,
      planLabel,
      lga,
      JSON.stringify(assessment),
      compactSpatial,
      body.model_result ? JSON.stringify(body.model_result) : null,
      body.audit_result ? JSON.stringify(body.audit_result) : null,
    )
    .run();

  return c.json({ id, project_ref: projectRef, status }, 201);
});

app.put("/consulting/api/jobs/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<Record<string, unknown>>();
  const assessment = (body.assessment ?? body) as Record<string, unknown>;

  const applicantName = String(assessment.applicant_name ?? "Unnamed Client").trim();
  const siteAddress = String(assessment.site_address ?? "Lismore NSW 2480").trim();
  const lotNumber = String(assessment.lot_number ?? "1").trim();
  const planLabel = String(assessment.plan_label ?? "DP000000").replace(/\s+/g, "").toUpperCase();
  const status = String(body.status ?? "field");
  const compactSpatial = compactSpatialForD1(body.spatial);

  const res = await c.env.DB.prepare(
    `UPDATE jobs
     SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         status = ?,
         applicant_name = ?,
         site_address = ?,
         lot_number = ?,
         plan_label = ?,
         assessment_json = ?,
         spatial_json = COALESCE(?, spatial_json),
         model_result_json = COALESCE(?, model_result_json),
         audit_result_json = COALESCE(?, audit_result_json)
     WHERE id = ?`,
  )
    .bind(
      status,
      applicantName,
      siteAddress,
      lotNumber,
      planLabel,
      JSON.stringify(assessment),
      compactSpatial,
      body.model_result ? JSON.stringify(body.model_result) : null,
      body.audit_result ? JSON.stringify(body.audit_result) : null,
      id,
    )
    .run();

  if (!res.meta.changes) return c.json({ error: "Job not found" }, 404);
  return c.json({ id, updated: true, status });
});

const ALLOWED_JOB_STATUSES = new Set(["precheck", "field", "drafted", "qa", "lodged", "approved"]);

app.patch("/consulting/api/jobs/:id/status", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ status?: string }>().catch(() => ({ status: "" }));
  const status = String(body.status || "").trim().toLowerCase();
  if (!ALLOWED_JOB_STATUSES.has(status)) {
    return c.json({ error: "Invalid status value." }, 400);
  }
  const res = await c.env.DB.prepare(
    `UPDATE jobs SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), status = ? WHERE id = ?`,
  )
    .bind(status, id)
    .run();
  if (!res.meta.changes) return c.json({ error: "Job not found" }, 404);
  return c.json({ id, status, updated: true });
});

app.delete("/consulting/api/jobs/:id", async (c) => {
  const id = c.req.param("id");
  const job = await c.env.DB.prepare("SELECT id, project_ref FROM jobs WHERE id = ?")
    .bind(id)
    .first<{ id: string; project_ref: string }>();
  if (!job) return c.json({ error: "Job not found" }, 404);

  // 1. Collect all R2 keys from job_files AND any objects stored under jobs/<id>/ prefix
  const { results: dbFiles } = await c.env.DB.prepare("SELECT r2_key FROM job_files WHERE job_id = ?")
    .bind(id)
    .all<{ r2_key: string }>();

  const r2Keys = new Set<string>((dbFiles ?? []).map((f) => f.r2_key).filter(Boolean));
  let cursor: string | undefined = undefined;
  do {
    const listed = await c.env.FILES.list({ prefix: `jobs/${id}/`, cursor });
    for (const obj of listed.objects) r2Keys.add(obj.key);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  const keysToDelete = Array.from(r2Keys);
  // R2 bulk delete supports up to 1000 keys per call
  for (let i = 0; i < keysToDelete.length; i += 500) {
    await c.env.FILES.delete(keysToDelete.slice(i, i + 500));
  }

  // 2. Atomically remove D1 rows (job_files, unlink converted enquiries, and jobs)
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM job_files WHERE job_id = ?").bind(id),
    c.env.DB.prepare("UPDATE enquiries SET converted_job_id = NULL, status = 'archived' WHERE converted_job_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM jobs WHERE id = ?").bind(id),
  ]);

  return c.json({
    id,
    project_ref: job.project_ref,
    deleted: true,
    deleted_files_count: keysToDelete.length,
  });
});

// ============================================================================
// R2 FILE STORAGE (Site Photos, Voice Memos, Generated .docx / .dxf / Maps)
// ============================================================================

const ALLOWED_FILE_KINDS = new Set([
  "photo",
  "audio",
  "docx",
  "dxf",
  "gis_map",
  "cad_plan",
  "audit_json",
  "client_doc",
]);
const MAX_R2_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB per file

app.post("/consulting/api/jobs/:id/files", async (c) => {
  const jobId = c.req.param("id");
  const jobExists = await c.env.DB.prepare("SELECT id FROM jobs WHERE id = ?").bind(jobId).first<{ id: string }>();
  if (!jobExists) {
    return c.json({ error: "Job not found" }, 404);
  }

  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return c.json({ error: "Multipart form field 'file' is required." }, 400);
  }
  if (file.size > MAX_R2_UPLOAD_BYTES) {
    return c.json({ error: `File exceeds maximum allowed upload size (${MAX_R2_UPLOAD_BYTES / (1024 * 1024)} MB).` }, 413);
  }

  const rawKind = String(form.get("kind") ?? "photo").trim();
  const kind = ALLOWED_FILE_KINDS.has(rawKind) ? rawKind : "client_doc";
  const caption = form.get("caption") ? String(form.get("caption")).slice(0, 500) : null;
  const lat = form.get("lat") ? Number(form.get("lat")) : null;
  const lon = form.get("lon") ? Number(form.get("lon")) : null;

  const fileId = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const r2Key = `jobs/${jobId}/${kind}/${fileId}_${safeName}`;
  const contentType = file.type || "application/octet-stream";

  await c.env.FILES.put(r2Key, file.stream(), {
    httpMetadata: { contentType },
    customMetadata: { jobId, kind, caption: caption ?? "" },
  });

  await c.env.DB.prepare(
    `INSERT INTO job_files (id, job_id, kind, filename, content_type, size_bytes, r2_key, caption, lat, lon)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(fileId, jobId, kind, safeName, contentType, file.size, r2Key, caption, lat, lon)
    .run();

  return c.json(
    {
      id: fileId,
      filename: safeName,
      kind,
      size_bytes: file.size,
      r2_key: r2Key,
      url: `/consulting/api/files/${r2Key}`,
    },
    201,
  );
});

app.get("/consulting/api/files/*", async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/consulting\/api\/files\//, ""));
  if (!key || key.includes("..") || !key.startsWith("jobs/")) {
    return c.json({ error: "Invalid file key" }, 400);
  }
  const obj = await c.env.FILES.get(key);
  if (!obj) return c.json({ error: "File not found" }, 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  const safeHeaders = buildSafeFileResponseHeaders(obj.httpMetadata?.contentType, key);
  for (const [k, v] of Object.entries(safeHeaders)) {
    headers.set(k, v);
  }
  headers.set("etag", obj.httpEtag);
  return new Response(obj.body, { headers });
});

// ============================================================================
// GOOGLE GEMINI AI INTAKE & GROUNDED REPORT WRITER (gemini-4-hydrogen)
// ============================================================================

app.get("/consulting/api/ai/status", (c) => {
  return c.json({
    configured: Boolean(c.env.GEMINI_API_KEY && c.env.GEMINI_API_KEY.trim().length > 5),
    model: c.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    supports_multimodal_pdf: true,
    guardrail: "Deterministic OSmodel300614 math locked; LLM handles intake extraction & narrative synthesis only.",
  });
});

app.post("/consulting/api/ai/extract", async (c) => {
  const apiKey = (c.env.GEMINI_API_KEY || c.req.header("x-gemini-api-key") || "").trim();
  if (!apiKey) {
    return c.json(
      {
        error: "GEMINI_API_KEY is not configured.",
        setup_hint: "Add GEMINI_API_KEY=... to cloudflare-app/.dev.vars (local) or run `npx wrangler secret put GEMINI_API_KEY` (production), or enter a temporary session key in the AI panel.",
      },
      400,
    );
  }

  const form = await c.req.formData();
  const notes = form.get("notes") ? String(form.get("notes")) : "";
  const jobId = form.get("job_id") ? String(form.get("job_id")).trim() : "";
  const modelOverride = form.get("model") ? String(form.get("model")).trim() : "";

  const uploadedEntries = [...form.getAll("files"), ...form.getAll("file")];
  const fileParts: GeminiFilePart[] = [];
  const archivedDocs: Array<{ filename: string; r2_key: string }> = [];

  for (const entry of uploadedEntries) {
    if (entry instanceof File && entry.size > 0) {
      if (entry.size > 18 * 1024 * 1024) {
        return c.json({ error: `File '${entry.name}' exceeds 18 MB inline upload limit.` }, 400);
      }
      const buf = await entry.arrayBuffer();
      const mimeType = entry.type || (entry.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
      fileParts.push({ filename: entry.name, mimeType, data: buf });

      // Archive uploaded client PDF/SEE in R2 when attached to a saved D1 job
      if (jobId) {
        try {
          const fileId = crypto.randomUUID();
          const safeName = entry.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const r2Key = `jobs/${jobId}/client_doc/${fileId}_${safeName}`;
          await c.env.FILES.put(r2Key, buf, {
            httpMetadata: { contentType: mimeType },
            customMetadata: { jobId, kind: "client_doc" },
          });
          await c.env.DB.prepare(
            `INSERT INTO job_files (id, job_id, kind, filename, content_type, size_bytes, r2_key, caption)
             VALUES (?, ?, 'client_doc', ?, ?, ?, ?, 'Uploaded client source document (AI intake)')`,
          )
            .bind(fileId, jobId, safeName, mimeType, entry.size, r2Key)
            .run();
          archivedDocs.push({ filename: safeName, r2_key: r2Key });
        } catch (_) {
          // Non-fatal if job isn't persisted in D1 yet
        }
      }
    }
  }

  if (fileParts.length === 0 && !notes.trim()) {
    return c.json({ error: "Attach at least one PDF/image/text file or paste unstructured notes to extract." }, 400);
  }

  try {
    const { extracted, modelUsed } = await extractStructuredAssessmentWithGemini({
      apiKey,
      model: modelOverride || c.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      notes,
      files: fileParts,
    });
    return c.json({
      ok: true,
      model_used: modelUsed,
      files_processed: fileParts.map((f) => f.filename),
      archived_docs: archivedDocs,
      extracted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: "Gemini extraction failed", detail: message }, 502);
  }
});

app.post("/consulting/api/ai/draft", async (c) => {
  const apiKey = (c.env.GEMINI_API_KEY || c.req.header("x-gemini-api-key") || "").trim();
  if (!apiKey) {
    return c.json(
      {
        error: "GEMINI_API_KEY is not configured.",
        setup_hint: "Add GEMINI_API_KEY=... to cloudflare-app/.dev.vars (local) or run `npx wrangler secret put GEMINI_API_KEY` (production), or enter a temporary session key in the AI panel.",
      },
      400,
    );
  }

  const body = await c.req.json<Record<string, unknown>>();
  const assessment = (body.assessment ?? {}) as Record<string, unknown>;
  const spatial = (body.spatial ?? null) as Record<string, unknown> | null;
  const modelResult = (body.model_result ?? {}) as Record<string, unknown>;
  const auditResult = (body.audit_result ?? {}) as Record<string, unknown>;
  const documentSummary = body.document_summary ? String(body.document_summary) : undefined;
  const customInstructions = body.custom_instructions ? String(body.custom_instructions) : undefined;
  const modelOverride = body.model ? String(body.model).trim() : undefined;

  try {
    const { custom_narratives, modelUsed } = await draftCustomReportNarrativesWithGemini({
      apiKey,
      model: modelOverride || c.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      assessment,
      spatial,
      modelResult,
      auditResult,
      documentSummary,
      customInstructions,
    });
    return c.json({ ok: true, model_used: modelUsed, custom_narratives });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: "Gemini report drafting failed", detail: message }, 502);
  }
});

app.post("/consulting/api/ai/draft-see", async (c) => {
  const apiKey = (c.env.GEMINI_API_KEY || c.req.header("x-gemini-api-key") || "").trim();
  if (!apiKey) {
    return c.json(
      {
        error: "GEMINI_API_KEY is not configured.",
        setup_hint: "Add GEMINI_API_KEY=... to cloudflare-app/.dev.vars (local) or run `npx wrangler secret put GEMINI_API_KEY` (production), or enter a temporary session key in Tab 1.",
      },
      400,
    );
  }

  const body = await c.req.json<Record<string, unknown>>();
  const seeInput = (body.see_input ?? {}) as Record<string, unknown>;
  const spatial = (body.spatial ?? null) as Record<string, unknown> | null;
  const documentSummary = body.document_summary ? String(body.document_summary) : undefined;
  const customInstructions = body.custom_instructions ? String(body.custom_instructions) : undefined;
  const modelOverride = body.model ? String(body.model).trim() : undefined;

  try {
    const { custom_narratives, modelUsed } = await draftCustomSeeNarrativesWithGemini({
      apiKey,
      model: modelOverride || c.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      seeInput,
      spatial,
      documentSummary,
      customInstructions,
    });
    return c.json({ ok: true, model_used: modelUsed, custom_narratives });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: "Gemini SEE drafting failed", detail: message }, 502);
  }
});

// Fallback to Cloudflare Workers Static Assets for /consulting/ and /consulting/app/
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
