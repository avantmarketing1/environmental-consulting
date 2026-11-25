import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

// 1. Verify public site has ZERO links to /consulting/app
const pubHtml = fs.readFileSync(path.join(appRoot, "public/consulting/index.html"), "utf-8");
assert.equal(pubHtml.includes("/consulting/app"), false, "Public /consulting/index.html must NOT link to /consulting/app!");

// 1b. Privacy guard: verify ZERO private client / property strings exist anywhere in deployed public/ or src/
const FORBIDDEN_RE = /stony\s*chute|wallaby|jeray|625836|liddy|747641|koonorigan|coyle/i;
function scanDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) scanDir(full);
    else {
      const txt = fs.readFileSync(full, "utf-8");
      const m = txt.match(FORBIDDEN_RE);
      assert.equal(m, null, `Privacy leak detected in ${full}: matched '${m?.[0]}'`);
    }
  }
}
scanDir(path.join(appRoot, "public"));
scanDir(path.join(appRoot, "src"));

// 2. Verify wrangler.jsonc enforces run_worker_first for /consulting/app* and /consulting/py/*
const wranglerCfg = fs.readFileSync(path.join(appRoot, "wrangler.jsonc"), "utf-8");
assert.ok(wranglerCfg.includes('"/consulting/app*"'), "wrangler.jsonc must enforce run_worker_first on /consulting/app*");
assert.ok(wranglerCfg.includes('"/consulting/py/*"'), "wrangler.jsonc must enforce run_worker_first on /consulting/py/*");

// 3. Test auth module crypto & route protection via Node TypeScript strip-types (Node 24 native!)
const auth = await import("../src/auth.ts");

// Route matrix checks
assert.equal(auth.isAdminProtectedPath("GET", "/consulting/"), false);
assert.equal(auth.isAdminProtectedPath("GET", "/consulting/api/health"), false);
assert.equal(auth.isAdminProtectedPath("GET", "/consulting/api/spatial/precheck"), false);
assert.equal(auth.isAdminProtectedPath("POST", "/consulting/api/enquiries"), false);

assert.equal(auth.isAdminProtectedPath("GET", "/consulting/app/"), true);
assert.equal(auth.isAdminProtectedPath("GET", "/consulting/app/app.js"), true);
assert.equal(auth.isAdminProtectedPath("GET", "/consulting/py/enviro_comply/engine/lismore_model.py"), true);
assert.equal(auth.isAdminProtectedPath("GET", "/consulting/api/jobs"), true);
assert.equal(auth.isAdminProtectedPath("POST", "/consulting/api/jobs"), true);
assert.equal(auth.isAdminProtectedPath("GET", "/consulting/api/enquiries"), true);
assert.equal(auth.isAdminProtectedPath("POST", "/consulting/api/enquiries/123/convert"), true);
assert.equal(auth.isAdminProtectedPath("GET", "/consulting/api/files/jobs/1/secret.pdf"), true);
assert.equal(auth.isAdminProtectedPath("POST", "/consulting/api/ai/extract"), true);
assert.equal(auth.isAdminProtectedPath("POST", "/consulting/api/ai/draft-see"), true);

// Constant-time password verification
assert.equal(await auth.verifyAdminPassword("super-secret-passphrase!", "super-secret-passphrase!"), true);
assert.equal(await auth.verifyAdminPassword("wrong-password", "super-secret-passphrase!"), false);
assert.equal(await auth.verifyAdminPassword("", "super-secret-passphrase!"), false);

// HMAC-SHA256 signed session cookie verification
const secret = "test-hmac-signing-secret-32-chars-minimum";
const token = await auth.createSignedSessionToken(secret);
assert.equal(await auth.verifySignedSessionToken(token, secret), true);
assert.equal(await auth.verifySignedSessionToken(token, "wrong-signing-secret"), false);
assert.equal(await auth.verifySignedSessionToken(token.slice(0, -3) + "xxx", secret), false);

// Rate limiter check
for (let i = 0; i < 3; i++) {
  assert.equal(auth.checkRateLimit("test-ip", 3, 60000).allowed, true);
}
assert.equal(auth.checkRateLimit("test-ip", 3, 60000).allowed, false);

console.log("[PASS] Public isolation, run_worker_first, HMAC-SHA256 session cookies, route auth matrix & rate limiter verified!");
