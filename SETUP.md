# Setup — IMAX 70mm Tracker

Everything below is free-tier. Budget ~30 min the first time. Work top to bottom;
each step gives you one or more environment variables. Put them in a local `.env`
(copy `.env.example`) for local dev, and paste the same ones into Vercel for prod.

## What you're wiring together
| Piece | Service | Free? | Gives you |
|---|---|---|---|
| Database | Neon (or Vercel Postgres) | yes | `DATABASE_URL` |
| Sign-in | Google Cloud OAuth | yes | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` |
| Showtime data (AMC) | AMC developer vendor key | yes | `AMC_VENDOR_KEY` |
| Email | Resend | yes (3k/mo) | `RESEND_API_KEY`, `EMAIL_FROM` |
| Scheduler | cron-job.org | yes | pings the poll endpoint |
| Hosting | Vercel Hobby | yes | your URL → `APP_URL` / `AUTH_URL` |

Plus two secrets you generate yourself: `AUTH_SECRET`, `CRON_SECRET`.

---

## 1. Database (Neon) → `DATABASE_URL`
1. Create a project at https://neon.tech (free).
2. Copy the **pooled** connection string.
3. `DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require"`

(Vercel Postgres works identically — it's Neon under the hood. Use its `DATABASE_URL`.)

## 2. Google sign-in → `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
1. https://console.cloud.google.com → create/select a project.
2. **APIs & Services → OAuth consent screen** → User type **External** → fill app name + your email → scopes: leave default (`email`, `profile`, `openid`). You do **not** need Google verification for these basic scopes.
   - While the app is in "Testing," only emails you add under **Test users** can sign in. Click **Publish app** to open it to anyone (still instant — no review for basic scopes).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
   - **Authorized JavaScript origins:** `http://localhost:3000` and `https://YOUR-APP.vercel.app`
   - **Authorized redirect URIs:** `http://localhost:3000/api/auth/callback/google` and `https://YOUR-APP.vercel.app/api/auth/callback/google`
4. Copy the Client ID / Secret → `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`.

## 3. AMC vendor key → `AMC_VENDOR_KEY` (covers Metreon + Universal CityWalk)
1. https://developers.amctheatres.com → **Get Started / New Vendor Request**. Ask for **Showtime/Catalog** access (display of showtimes) — this tier is free. Approval can take a few days.
2. When approved, copy the key → `AMC_VENDOR_KEY`.
3. **Resolve the two AMC theatre IDs** (AMC hides these publicly). With the key set locally:
   ```bash
   AMC_VENDOR_KEY=your_key npm run resolve:amc
   ```
   Paste the printed `externalId` values into `lib/theatres.ts` (replacing the two `AMC_*_TODO` placeholders), then re-run `npm run db:seed`.
   - The 4 Regal theatre IDs are already filled in and verified.

> Until the AMC key + IDs are in place, the 2 AMC theatres simply return no data;
> the 4 Regal theatres work independently. Nothing crashes.

## 4. Email (Resend) → `RESEND_API_KEY`, `EMAIL_FROM`
1. https://resend.com → sign up → **API Keys → Create**. → `RESEND_API_KEY`.
2. Sender: to start fast use the shared onboarding sender `EMAIL_FROM="70mm Tracker <onboarding@resend.dev>"`. For better deliverability later, verify your own domain in Resend and use `alerts@yourdomain.com`.
3. **Phone push:** these are ordinary emails. Install the Gmail (or Apple Mail) app on your phone and enable its notifications — a drop email then lands as a lock-screen push. (Optional real Web Push can be added later.)

## 5. Secrets you generate
```bash
openssl rand -base64 32   # → AUTH_SECRET
openssl rand -base64 32   # → CRON_SECRET (used by the scheduler + dismiss links)
```
Also set `APP_URL` and `AUTH_URL` to your site root (`http://localhost:3000` locally, `https://YOUR-APP.vercel.app` in prod).

---

## 6. Run it locally
```bash
npm install
cp .env.example .env      # then fill in everything above
npm run db:push           # create tables in your Neon DB
npm run db:seed           # insert the 6 theatres + The Odyssey
npm run dev               # http://localhost:3000
```
Sign in with Google, open **/dashboard**, toggle tracking on The Odyssey.
Test the pipeline without waiting for a real drop:
```bash
curl -X POST http://localhost:3000/api/cron/poll -H "Authorization: Bearer YOUR_CRON_SECRET"
```
You'll get a JSON summary (theatres polled, new drops, reminders sent).

## 7. Deploy to Vercel
1. Push this branch to GitHub, import the repo at https://vercel.com/new (framework auto-detected as Next.js).
2. Add **every** env var from your `.env` in **Project → Settings → Environment Variables** (set `APP_URL`/`AUTH_URL` to the real `https://YOUR-APP.vercel.app`).
3. Deploy. Then update the Google OAuth origins/redirect URIs (step 2) with the real domain if you used a placeholder.
4. Run the DB steps once against prod (locally with prod `DATABASE_URL`, or via a one-off): `npm run db:push && npm run db:seed`.

## 8. The scheduler (this is what makes it fast) → cron-job.org
Vercel's free cron only fires once/day, so we use a free external scheduler:
1. https://cron-job.org → create a cronjob.
2. **URL:** `https://YOUR-APP.vercel.app/api/cron/poll`
3. **Method:** POST · **Schedule:** every 10 minutes.
4. **Headers:** `Authorization: Bearer YOUR_CRON_SECRET`
5. Save + enable. (GitHub Actions `schedule` works too if you prefer — same request.)

That endpoint does everything each run: detect new 70mm showtimes → email you → send the hourly reminders (up to 3) → stop when you click **"Don't need to track this movie."**

---

## Adding another 70mm movie later
No code needed. Sign in → **/movies** → add title, a slug, and a matchers JSON, e.g.:
```json
{ "amc":   { "movieIds": ["12345"], "titlePattern": "dune" },
  "regal": { "hoCodes": ["ho00099999"], "titlePattern": "dune" } }
```
Find AMC `movieId` in the amctheatres.com movie URL; find the Regal `hoCode` in the
regmovies.com movie URL (use the **70mm** version's code). `titlePattern` is a
case-insensitive fallback match on the showtime's movie title.

## Good to know
- **Regal scraping is unofficial** and sits behind Cloudflare. If Regal changes its
  site or challenges requests, that adapter (`lib/adapters/regal.ts`) may need a
  field/header tweak — it fails safe (returns nothing) rather than crashing. AMC uses
  the sanctioned API and is stable.
- Reminders are per drop event: email #1 on detection, then +1h and +2h (3 total),
  each with a one-click dismiss link. Dismissing also stops tracking that movie for you.
