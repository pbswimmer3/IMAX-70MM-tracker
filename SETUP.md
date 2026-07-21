# Setup — IMAX 70mm Tracker

Everything here is free-tier. Budget ~30 min the first time.

## Architecture (why there's no showtime API key)
Both chains' direct APIs turned out unusable (AMC rejects vendor keys with 403;
Regal's endpoint is Cloudflare-walled even from home IPs). So showtimes are
gathered by a **headless-browser scraper** that runs on **GitHub Actions**:

```
GitHub Actions (every 30 min, real Chromium)
   → loads each AMC theatre's /showtimes page (bypasses Cloudflare)
   → parses IMAX 70mm showtimes from the page's Next.js data
   → POSTs them to  /api/ingest  on your Vercel app
        → detects new drops → emails you → hourly reminders ×3 → dashboard
```

- **AMC (Metreon + Universal CityWalk)** — working, validated, free.
- **Regal (4 theatres)** — **deferred**: Cloudflare blocks GitHub's datacenter IPs.
  The scraper skips them for now; re-enable later with a residential proxy
  (see "Re-enabling Regal" at the bottom). Nothing else depends on them.

## What you're wiring together
| Piece | Service | Free? | Gives you |
|---|---|---|---|
| Database | Neon (or Vercel Postgres) | yes | `DATABASE_URL` |
| Sign-in | Google Cloud OAuth | yes | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` |
| Email | Resend | yes (3k/mo) | `RESEND_API_KEY`, `EMAIL_FROM` |
| Scraper | GitHub Actions | yes | runs the scraper on a schedule |
| Hosting | Vercel Hobby | yes | your URL → `APP_URL` / `AUTH_URL` |

Plus two secrets you generate: `AUTH_SECRET`, `CRON_SECRET`. (No AMC key needed.)

---

## 1. Database (Neon) → `DATABASE_URL`
1. Create a project at https://neon.tech (free) → copy the **pooled** connection string.
2. `DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require"`

## 2. Google sign-in → `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
1. https://console.cloud.google.com → create/select a project.
2. **OAuth consent screen** → User type **External** → app name + your email → default
   scopes (`email`, `profile`, `openid`). No Google verification needed for these.
   Add yourself under **Test users**, or **Publish app** to open it to anyone.
3. **Credentials → Create credentials → OAuth client ID → Web application**:
   - Authorized origins: `http://localhost:3000` and `https://YOUR-APP.vercel.app`
   - Redirect URIs: `http://localhost:3000/api/auth/callback/google` and
     `https://YOUR-APP.vercel.app/api/auth/callback/google`
4. Copy Client ID / Secret → `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`.

## 3. Email (Resend) → `RESEND_API_KEY`, `EMAIL_FROM`
1. https://resend.com → **API Keys → Create** → `RESEND_API_KEY`.
2. Start fast with the shared sender: `EMAIL_FROM="70mm Tracker <onboarding@resend.dev>"`.
   For better deliverability later, verify your own domain and use `alerts@yourdomain.com`.
3. **Phone push:** these are normal emails — install the Gmail/Apple Mail app and enable
   notifications so a drop email lands as a lock-screen push.

## 4. Secrets you generate
```bash
openssl rand -base64 32   # → AUTH_SECRET
openssl rand -base64 32   # → CRON_SECRET  (auth for /api/ingest + dismiss links)
```
Set `APP_URL` and `AUTH_URL` to your site root (`http://localhost:3000` locally,
`https://YOUR-APP.vercel.app` in prod).

---

## 5. Run it locally
```bash
npm install
cp .env.example .env      # fill in everything above
npm run db:push           # create tables in Neon
npm run db:seed           # insert the 6 theatres + The Odyssey
npm run dev               # http://localhost:3000
```
Sign in with Google, open **/dashboard**, toggle tracking on The Odyssey.

Optional — try the scraper locally (works from your home IP, and can even reach Regal):
```bash
cd scraper && npm install && npx playwright install chromium
DRY_RUN=1 npx tsx scrape.ts        # logs what it finds, posts nothing
```

## 6. Deploy to Vercel
1. Import the repo at https://vercel.com/new (Next.js auto-detected).
2. Add every env var from your `.env` in **Settings → Environment Variables**
   (set `APP_URL`/`AUTH_URL` to the real `https://YOUR-APP.vercel.app`).
3. Deploy. Update the Google OAuth origins/redirect URIs with the real domain.
4. Run the DB steps once against prod (locally with the prod `DATABASE_URL`):
   `npm run db:push && npm run db:seed`.

## 7. Turn on the scraper (GitHub Actions)
1. In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**:
   - `APP_URL` = `https://YOUR-APP.vercel.app`
   - `CRON_SECRET` = the same value from step 4
2. The workflow `.github/workflows/scrape.yml` runs **every 30 minutes** and POSTs to
   `/api/ingest`. **Scheduled runs only fire on the repo's default branch**, so the
   schedule activates once this branch is merged to `main`.
3. Before/at merge, remove the temporary `push:` trigger block at the top of
   `scrape.yml` (it's only there for dry-run testing on the dev branch).
4. Check **Actions → Scrape showtimes** to watch runs; each logs how many showtimes it
   found and posted.

That's it — when The Odyssey's IMAX 70mm showtimes appear at Metreon or CityWalk, you
get an email within ~30 min, then hourly reminders (3 total) until you click
**"Don't need to track this movie."** (The scraper triggers reminders on each run, so
no separate scheduler is needed.)

---

## Adding another 70mm movie later
Sign in → **/movies** → add a title, slug, and matchers JSON, e.g.:
```json
{ "amc": { "movieIds": ["12345"], "titlePattern": "dune" } }
```
Find the AMC `movieId` in the amctheatres.com movie URL. `titlePattern` is a
case-insensitive fallback on the movie title. The scraper already flags `is70mm`
per showtime, so any tracked movie playing in IMAX 70mm at an AMC theatre is caught.

## Re-enabling Regal (the 4 deferred theatres)
Regal's pages sit behind Cloudflare's managed challenge, which blocks datacenter
IPs (GitHub Actions). To add them, route the scraper's Regal requests through a
**residential proxy** (e.g. IPRoyal/Webshare, ~$5–15/mo for this tiny volume) or
run the scraper on a residential machine. Then remove the `if (theatre.chain ===
"REGAL") { ...continue }` skip in `scraper/scrape.ts`. The Regal parser and config
are already in place. (Your home IP already loads these pages, as the local dry-run
in step 5 shows.)

## Good to know
- **Scraping is unofficial** and against the sites' ToS; fine for personal use, but
  it can break if AMC changes its page structure — the AMC parser
  (`scraper/parseAmc.ts`) would then need a tweak. It fails safe (posts nothing)
  rather than crashing.
- Reminders: email #1 on detection, then +1h and +2h (3 total), each with a
  one-click dismiss link that also stops tracking that movie for you.
