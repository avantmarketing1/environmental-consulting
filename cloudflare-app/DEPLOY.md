# Deploying Field To Forest Compliance Studio to Cloudflare (Production + Security Guide)

This deploys `fieldtoforestfarm.com/consulting/` (public landing page, free Lot/DP pre-check & quote form) and your **private, password-protected Consultant Studio** at `fieldtoforestfarm.com/consulting/app/` directly on **Cloudflare's Free Plan** — without touching your main `fieldtoforestfarm-website` or `/app` permaculture app.

---

## Step 1 — Sign In to Cloudflare Wrangler (One-Time)

Open PowerShell in the `cloudflare-app` folder:

```powershell
cd C:\Users\Avant\Documents\Apps\environmental-consulting\cloudflare-app
npx wrangler login
```

This opens your browser to authorise Wrangler with your Cloudflare account.

---

## Step 2 — Create Your Production D1 Database & R2 Storage Bucket

```powershell
npx wrangler d1 create fieldtoforest-consulting-db
npx wrangler r2 bucket create fieldtoforest-consulting-files
```

1. Copy the **`database_id`** printed by `wrangler d1 create`.
2. Open `cloudflare-app/wrangler.jsonc` and replace `"00000000-0000-0000-0000-000000000000"` with your real `database_id`.
3. Apply the SQL schema to your **remote** Cloudflare D1 database:

```powershell
npm run db:migrate:remote
```

---

## Step 3 — Set Your Encrypted Production Secrets (NEVER Put Passwords in Git!)

Set your three encrypted secrets on Cloudflare:

```powershell
# 1. Strong password to unlock https://fieldtoforestfarm.com/consulting/app/
npx wrangler secret put ADMIN_PASSWORD

# 2. Long random string (32+ chars) for signing HttpOnly HMAC-SHA256 session cookies
npx wrangler secret put SESSION_SECRET

# 3. Your Google AI Studio Gemini API key (for gemini-4-hydrogen PDF intake & report drafting)
npx wrangler secret put GEMINI_API_KEY
```

> **Fail-Closed Safety:** The Worker is engineered to **fail closed (HTTP 503)** in production if `ADMIN_PASSWORD` is missing. Nobody can access `/consulting/app/`, `/consulting/api/jobs*`, `/consulting/api/files/*`, `/consulting/api/ai/*`, or read enquiries (`GET /consulting/api/enquiries`) without signing in.

---

## Step 4 — Mount on `fieldtoforestfarm.com/consulting*` & Disable `*.workers.dev`

Open `cloudflare-app/wrangler.jsonc` and:
1. Add `"workers_dev": false` so nobody can bypass your domain's Cloudflare WAF/Access rules via a `*.workers.dev` preview URL.
2. Uncomment the `routes` block:

```jsonc
  "workers_dev": false,
  "routes": [
    { "pattern": "fieldtoforestfarm.com/consulting*", "zone_name": "fieldtoforestfarm.com" }
  ]
```

Then deploy to Cloudflare's global edge network:

```powershell
npm run deploy
```

Your live URLs are now:
- **Public Site (for clients):** `https://fieldtoforestfarm.com/consulting/` *(zero links to admin area)*
- **Private Admin Studio (bookmark privately):** `https://fieldtoforestfarm.com/consulting/app/` *(redirects unauthenticated visitors to `/consulting/admin-login`)*

---

## Step 5 — Turn On Cloudflare Edge DDoS, WAF & Zero Trust Security (Free Plan!)

Log into the **Cloudflare Dashboard** for `fieldtoforestfarm.com`:

### A. Automatic DDoS Protection & Strict HTTPS (Included Free)
1. **DNS → Records:** Ensure `fieldtoforestfarm.com` is **Proxied (Orange Cloud ☁️)** — this automatically enables Cloudflare's unmetered L3/L4/L7 DDoS mitigation.
2. **SSL/TLS → Overview:** Set encryption mode to **Full (Strict)** and enable **Always Use HTTPS** under *Edge Certificates*.
3. **Security → Bots:** Enable **Bot Fight Mode** (blocks automated scrapers and credential-stuffing bots for free).

### B. Edge WAF Rate Limiting Rule (Blocks Brute-Force & Spam Before Hitting Your Worker)
Go to **Security → WAF → Rate limiting rules → Create rule** (1 free rule included on Free Plan):
- **Rule name:** `Protect Consulting API & Admin Login`
- **If incoming requests match:**
  - `URI Path` *starts with* `/consulting/api/auth/login`
  - **OR** `URI Path` *equals* `/consulting/api/enquiries`
  - **OR** `URI Path` *starts with* `/consulting/api/spatial/precheck`
- **Requests:** `20` requests per `10 seconds` per IP
- **Action:** `Block` (for 60 seconds)

*(Note: Your Worker ALSO enforces per-IP login throttling — max 8 attempts / 15 min + 450 ms wrong-password delay — as a second layer of defense.)*

### C. Cloudflare Zero Trust Access (Double-Lock Edge Auth — Free for up to 50 Users!)
For maximum security, put **Cloudflare Access** in front of `/consulting/app*` so attackers can't even reach your login screen without first authenticating via one-time email code or Google SSO:
1. Open **Cloudflare Dashboard → Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. **Application name:** `Field To Forest Compliance Studio`
3. **Application domain:** `fieldtoforestfarm.com`, **Path:** `consulting/app`
4. **Policy:** Action = **Allow**, Include = **Emails** → enter your personal email address(es).
5. Save! *(Optional: If you want Zero Trust to sign you in automatically without entering `ADMIN_PASSWORD` a second time, set `TRUST_CF_ACCESS = "true"` in `wrangler.jsonc` `vars`.)*

### D. Emergency "Under Attack Mode"
If you ever notice a coordinated DDoS spike, toggle **Quick Actions → Under Attack Mode** in your Cloudflare Overview dashboard — Cloudflare will immediately challenge suspicious traffic at the edge.
