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

// XSS-hardened R2 file response headers (HTML/SVG must NEVER render inline!)
const htmlHeaders = auth.buildSafeFileResponseHeaders("text/html; charset=utf-8", "jobs/1/client_doc/evil.html");
assert.equal(htmlHeaders["Content-Type"], "application/octet-stream");
assert.ok(htmlHeaders["Content-Disposition"].startsWith("attachment;"));
assert.equal(htmlHeaders["Content-Security-Policy"], "sandbox; default-src 'none'");

const svgHeaders = auth.buildSafeFileResponseHeaders("image/svg+xml", "jobs/1/photo/diagram.svg");
assert.equal(svgHeaders["Content-Type"], "application/octet-stream");
assert.ok(svgHeaders["Content-Disposition"].startsWith("attachment;"));

const jpgHeaders = auth.buildSafeFileResponseHeaders("image/jpeg", "jobs/1/photo/site.jpg");
assert.equal(jpgHeaders["Content-Type"], "image/jpeg");
assert.ok(jpgHeaders["Content-Disposition"].startsWith("inline;"));
assert.equal(jpgHeaders["X-Content-Type-Options"], "nosniff");

// Cryptographic Cloudflare Access RS256 JWT verification
const b64u = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const kp = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const pubJwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "test-kid-1" };
const nowSec = Math.floor(Date.now() / 1000);
async function makeJwt(payloadObj) {
  const h = b64u(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-kid-1" }));
  const p = b64u(JSON.stringify(payloadObj));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(new Uint8Array(sig))}`;
}

const validJwt = await makeJwt({
  iss: "https://example.cloudflareaccess.com",
  aud: ["test-aud-tag"],
  exp: nowSec + 300,
  email: "consultant@fieldtoforestfarm.com",
});
const okAccess = await auth.verifyCloudflareAccessJwt(validJwt, "example.cloudflareaccess.com", "test-aud-tag", [pubJwk]);
assert.equal(okAccess.valid, true);
assert.equal(okAccess.email, "consultant@fieldtoforestfarm.com");

const wrongAud = await auth.verifyCloudflareAccessJwt(validJwt, "example.cloudflareaccess.com", "wrong-aud", [pubJwk]);
assert.equal(wrongAud.valid, false);

const expiredJwt = await makeJwt({
  iss: "https://example.cloudflareaccess.com",
  aud: ["test-aud-tag"],
  exp: nowSec - 10,
  email: "consultant@fieldtoforestfarm.com",
});
const expiredAccess = await auth.verifyCloudflareAccessJwt(expiredJwt, "example.cloudflareaccess.com", "test-aud-tag", [pubJwk]);
assert.equal(expiredAccess.valid, false);

const tamperedAccess = await auth.verifyCloudflareAccessJwt(validJwt.slice(0, -4) + "AAAA", "example.cloudflareaccess.com", "test-aud-tag", [pubJwk]);
assert.equal(tamperedAccess.valid, false);

console.log("[PASS] Public isolation, run_worker_first, HMAC-SHA256 cookies, CF Access RS256 JWT, R2 XSS headers & rate limiter verified!");
