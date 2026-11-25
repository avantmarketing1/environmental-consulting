/**
 * Cryptographic Admin Authentication, Session Cookie Signing & Burst Rate Limiting
 * for Field To Forest Environmental Consulting (Cloudflare Workers Free Plan).
 *
 * Defense-in-depth design:
 *  - Constant-time SHA-256 comparison for ADMIN_PASSWORD (immune to timing attacks)
 *  - HMAC-SHA256 signed HttpOnly, Secure, SameSite=Strict session cookie (12h TTL)
 *  - Fail-CLOSED in production: any non-localhost host without ADMIN_PASSWORD returns 503
 *  - Localhost dev convenience: if ADMIN_PASSWORD is unset on 127.0.0.1/localhost, allows local dev;
 *    if ADMIN_PASSWORD IS set in .dev.vars, enforces full login locally so you can test it!
 *  - Works alongside Cloudflare Zero Trust Access + WAF + DDoS Mitigation at the edge.
 */

export const SESSION_COOKIE_NAME = "ftf_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

const textEnc = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str: string): Uint8Array | null {
  try {
    const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch (_) {
    return null;
  }
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sha256Bytes(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", textEnc.encode(input));
  return new Uint8Array(digest);
}

async function hmacSign(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEnc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, textEnc.encode(message));
  return new Uint8Array(sig);
}

export async function verifyAdminPassword(candidate: string, expectedSecret: string): Promise<boolean> {
  if (!candidate || !expectedSecret) return false;
  const [h1, h2] = await Promise.all([sha256Bytes(candidate), sha256Bytes(expectedSecret)]);
  return constantTimeEqual(h1, h2);
}

export async function createSignedSessionToken(signingSecret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ sub: "ftf-admin", iat: now, exp: now + SESSION_TTL_SECONDS });
  const payloadB64 = toBase64Url(textEnc.encode(payload));
  const sig = await hmacSign(signingSecret, payloadB64);
  return `${payloadB64}.${toBase64Url(sig)}`;
}

export async function verifySignedSessionToken(token: string, signingSecret: string): Promise<boolean> {
  if (!token || !signingSecret) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, sigB64] = parts;
  const expectedSig = await hmacSign(signingSecret, payloadB64);
  const providedSig = fromBase64Url(sigB64);
  if (!providedSig || !constantTimeEqual(expectedSig, providedSig)) return false;

  const payloadBytes = fromBase64Url(payloadB64);
  if (!payloadBytes) return false;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as { exp?: number; sub?: string };
    const now = Math.floor(Date.now() / 1000);
    return parsed.sub === "ftf-admin" && typeof parsed.exp === "number" && parsed.exp > now;
  } catch (_) {
    return false;
  }
}

export function extractCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

export function buildSessionCookieHeader(token: string, isHttps: boolean): string {
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/consulting",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (isHttps) attrs.push("Secure");
  return attrs.join("; ");
}

export function buildLogoutCookieHeader(isHttps: boolean): string {
  const attrs = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/consulting",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (isHttps) attrs.push("Secure");
  return attrs.join("; ");
}

export function isLocalhostUrl(urlStr: string): boolean {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch (_) {
    return false;
  }
}

export function isAdminProtectedPath(method: string, pathname: string): boolean {
  const m = method.toUpperCase();
  // Admin Workbench UI & synced Python engine files
  if (pathname === "/consulting/app" || pathname.startsWith("/consulting/app/")) return true;
  if (pathname.startsWith("/consulting/py/")) return true;
  // Private Consultant APIs (jobs CRUD, R2 files, Gemini AI, reading/converting enquiries)
  if (pathname.startsWith("/consulting/api/jobs")) return true;
  if (pathname.startsWith("/consulting/api/files")) return true;
  if (pathname.startsWith("/consulting/api/ai")) return true;
  if (pathname === "/consulting/api/enquiries" && m !== "POST") return true;
  if (pathname.startsWith("/consulting/api/enquiries/")) return true;
  return false;
}

/** Lightweight per-isolate sliding-window rate limiter (pairs with Cloudflare Edge WAF Rate Limiting). */
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, maxRequests: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  if (rateBuckets.size > 2000) {
    for (const [k, v] of rateBuckets.entries()) {
      if (v.resetAt <= now) rateBuckets.delete(k);
    }
  }
  const existing = rateBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (existing.count >= maxRequests) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }
  existing.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

export function renderAdminLoginHtml(nextPath = "/consulting/app/"): string {
  const safeNext = nextPath.startsWith("/consulting/app") ? nextPath : "/consulting/app/";
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Consultant Sign In — Field To Forest Compliance Studio</title>
  <link rel="stylesheet" href="/consulting/styles/ftf.css?v=8" />
  <script>
    (function () {
      const saved = localStorage.getItem("ftf_theme");
      document.documentElement.setAttribute("data-theme", saved || "dark");
    })();
  </script>
</head>
<body style="min-height:100vh; display:grid; place-items:center; padding:20px;">
  <div class="card" style="max-width:420px; width:100%; padding:28px;">
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px;">
      <span class="brand-mark">FF</span>
      <div>
        <div style="font-family:Fraunces,Georgia,serif; font-weight:700; font-size:1.15rem; color:var(--heading);">Field To Forest</div>
        <div style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted);">Private Consultant Studio</div>
      </div>
    </div>

    <span class="badge badge-info" style="margin-bottom:10px;">Protected Admin Access</span>
    <h1 style="margin:6px 0 6px; font-size:1.45rem;">Consultant Sign In</h1>
    <p style="margin:0 0 18px; font-size:0.86rem; color:var(--muted);">
      Enter your Field To Forest administrator password to access the OSSM &amp; SEE Compliance Studio.
    </p>

    <form id="loginForm">
      <div class="field">
        <label for="pwInput">Administrator Password</label>
        <input id="pwInput" type="password" autocomplete="current-password" required autofocus placeholder="Enter admin password" />
      </div>
      <div id="errBox" style="display:none; margin-bottom:12px; padding:9px 11px; border-radius:8px; background:var(--fail-bg); color:var(--fail-fg); font-size:0.84rem; font-weight:600;"></div>
      <button id="submitBtn" type="submit" class="btn btn-primary" style="width:100%;">Unlock Studio &rarr;</button>
    </form>

    <div style="margin-top:16px; padding-top:14px; border-top:1px solid var(--border); font-size:0.78rem; color:var(--muted); display:flex; justify-content:space-between; align-items:center;">
      <span>Protected by HMAC-SHA256 + Cloudflare Edge</span>
      <a href="/consulting/">&larr; Public Site</a>
    </div>
  </div>

  <script>
    const nextUrl = ${JSON.stringify(safeNext)};
    document.getElementById("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("submitBtn");
      const err = document.getElementById("errBox");
      btn.disabled = true;
      err.style.display = "none";
      try {
        const resp = await fetch("/consulting/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: document.getElementById("pwInput").value }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          throw new Error(data.error || "Sign in failed");
        }
        window.location.href = nextUrl;
      } catch (ex) {
        err.textContent = ex.message;
        err.style.display = "block";
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}
