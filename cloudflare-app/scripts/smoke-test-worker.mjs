import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const BASE = "http://127.0.0.1:8787";

const proc = spawn(
  process.platform === "win32" ? "cmd.exe" : "npx",
  process.platform === "win32"
    ? ["/c", "npx", "wrangler", "dev", "--port", "8787", "--ip", "127.0.0.1"]
    : ["wrangler", "dev", "--port", "8787", "--ip", "127.0.0.1"],
  { cwd: appRoot, stdio: ["ignore", "pipe", "pipe"] },
);

let logs = "";
proc.stdout.on("data", (d) => (logs += d.toString()));
proc.stderr.on("data", (d) => (logs += d.toString()));

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/consulting/api/health`);
      if (r.ok) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Wrangler dev did not start within ${timeoutMs}ms.\nLogs:\n${logs}`);
}

try {
  await waitForServer();

  // 1. Health API
  const health = await (await fetch(`${BASE}/consulting/api/health`)).json();
  assert.equal(health.status, "ok");
  assert.equal(health.brand, "Field To Forest");
  console.log("[1/7] GET /consulting/api/health -> OK");

  // 2. Public Landing Page (/consulting/)
  const pubHtml = await (await fetch(`${BASE}/consulting/`)).text();
  assert.ok(pubHtml.includes("Field To Forest") && pubHtml.includes("Free Instant Lismore Lot/DP"));
  console.log("[2/7] GET /consulting/ -> OK");

  // 3. Consultant Workbench PWA (/consulting/app/)
  const appHtml = await (await fetch(`${BASE}/consulting/app/`)).text();
  assert.ok(appHtml.includes("OSSM Workbench") && appHtml.includes("Compile .DOCX + .DXF Package"));
  console.log("[3/7] GET /consulting/app/ -> OK");

  // 4. Synced Python Engine Asset (/consulting/py/enviro_comply/engine/lismore_model.py)
  const pyResp = await fetch(`${BASE}/consulting/py/enviro_comply/engine/lismore_model.py`);
  assert.equal(pyResp.status, 200);
  console.log("[4/7] GET /consulting/py/enviro_comply/engine/lismore_model.py -> OK");

  // 5. Live NSW Spatial Services GIS Pre-Check via Edge Worker
  const spResp = await fetch(`${BASE}/consulting/api/spatial/precheck?lot=5&plan=DP625836`);
  const sp = await spResp.json();
  assert.equal(spResp.status, 200);
  assert.equal(sp.fetched_live, true);
  assert.ok(sp.parcel_area_ha > 50, `Expected ~55 ha, got ${sp.parcel_area_ha}`);
  assert.ok(sp.land_zoning.some((z) => z.includes("RU1")), `Expected RU1 zoning, got ${sp.land_zoning}`);
  console.log(`[5/7] GET /consulting/api/spatial/precheck?lot=5&plan=DP625836 -> LIVE (${sp.parcel_area_ha} ha, ${sp.land_zoning.join(", ")})`);

  // 6. D1 SQL Enquiry -> Convert to Job -> Fetch Job
  const enqResp = await fetch(`${BASE}/consulting/api/enquiries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      full_name: "Smoke Test Owner",
      email: "owner@fieldtoforestfarm.com",
      site_address: "Site 2/4 Wallaby Rd, Stony Chute NSW 2480",
      lot_number: "5",
      plan_label: "DP625836",
      bedrooms: 2,
      notes: "Test enquiry from smoke test",
    }),
  });
  assert.equal(enqResp.status, 201);
  const enq = await enqResp.json();

  const convResp = await fetch(`${BASE}/consulting/api/enquiries/${enq.id}/convert`, { method: "POST" });
  assert.equal(convResp.status, 201);
  const conv = await convResp.json();

  const jobResp = await fetch(`${BASE}/consulting/api/jobs/${conv.job_id}`);
  assert.equal(jobResp.status, 200);
  const job = await jobResp.json();
  assert.equal(job.applicant_name, "Smoke Test Owner");
  console.log(`[6/7] D1 SQL Enquiry -> Convert -> Job (${conv.project_ref}) -> OK`);

  // 6b. Direct POST /consulting/api/jobs with full live NSW GIS spatial payload + duplicate project_ref upsert
  const directRef = `SMOKE-${Date.now()}`;
  const saveResp1 = await fetch(`${BASE}/consulting/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "field",
      assessment: { project_ref: directRef, applicant_name: "Direct Save Test", site_address: "Lismore NSW", lot_number: "5", plan_label: "DP625836" },
      spatial: sp,
    }),
  });
  assert.equal(saveResp1.status, 201, `Expected 201, got ${saveResp1.status}`);
  const saved1 = await saveResp1.json();
  const saveResp2 = await fetch(`${BASE}/consulting/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "field",
      assessment: { project_ref: directRef, applicant_name: "Direct Save Updated", site_address: "Lismore NSW", lot_number: "5", plan_label: "DP625836" },
      spatial: sp,
    }),
  });
  assert.equal(saveResp2.status, 200, "Duplicate project_ref POST should upsert cleanly");
  await fetch(`${BASE}/consulting/api/jobs/${saved1.id}`, { method: "DELETE" });
  console.log(`[6b/7] Direct POST /consulting/api/jobs with live NSW GeoJSON + upsert -> OK`);

  // 7. R2 Object Storage Upload & Download
  const fd = new FormData();
  fd.append("file", new Blob(["Field To Forest R2 test payload"], { type: "text/plain" }), "smoke_test.txt");
  fd.append("kind", "audit_json");
  fd.append("caption", "Smoke test artifact");
  const upResp = await fetch(`${BASE}/consulting/api/jobs/${conv.job_id}/files`, { method: "POST", body: fd });
  assert.equal(upResp.status, 201);
  const up = await upResp.json();

  const dlText = await (await fetch(`${BASE}${up.url}`)).text();
  assert.equal(dlText, "Field To Forest R2 test payload");
  console.log(`[7/7] R2 Upload + Download (${up.r2_key}) -> OK`);

  // Clean up smoke-test job so local D1 stays tidy
  await fetch(`${BASE}/consulting/api/jobs/${conv.job_id}`, { method: "DELETE" });
  console.log("\nALL 7 LIVE CLOUDFLARE WORKER + D1 + R2 + NSW GIS CHECKS PASSED!");
} finally {
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(proc.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    proc.kill("SIGTERM");
  }
}
