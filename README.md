# IMAX 70mm Tracker

Get emailed the moment IMAX 70mm showtimes drop at the theatres you care about —
so you can grab tickets before they sell out. Built for The Odyssey (Christopher
Nolan), extensible to any 70mm film.

## How it works
A GitHub Actions job runs a headless-browser scraper every ~30 min (both chains'
direct APIs are blocked, so a real browser is used). It reads each AMC theatre's
server-rendered showtimes, detects newly released **IMAX 70mm** screenings, and POSTs
them to `/api/ingest`, which emails you — then sends hourly reminders (up to 3) until
you click *"Don't need to track this movie."* Google sign-in; each user tracks their
own movies. Regal's 4 theatres are deferred (Cloudflare blocks datacenter IPs; see
SETUP.md to re-enable with a residential proxy).

## Watched theatres
1. AMC Metreon 16 & IMAX — San Francisco
2. Regal Hacienda Crossings & IMAX — Dublin
3. Universal Cinema AMC at CityWalk Hollywood & IMAX — Universal City
4. Regal Irvine Spectrum & IMAX — Irvine
5. Regal LA Live & IMAX — Los Angeles
6. Regal Edwards Ontario Palace & IMAX — Ontario

## Stack
Next.js 14 (App Router) · Prisma + Postgres · Auth.js (Google) · Resend email ·
Vercel · Playwright scraper on GitHub Actions. All free-tier.

## Get started
See **[SETUP.md](./SETUP.md)** for the full step-by-step (accounts, env vars, deploy,
scheduler). Notification design directions live in `design/notifications.html`.

```bash
npm install
cp .env.example .env   # fill in per SETUP.md
npm run db:push && npm run db:seed
npm run dev
```

## Environment variables
All variables live in `.env` (see `.env.example`); the scheduled scraper additionally
needs `APP_URL` and `CRON_SECRET` as GitHub Actions repo secrets. Full setup for each
is in [SETUP.md](./SETUP.md).

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string (Neon, Supabase, local) |
| `AUTH_SECRET` | yes | Auth.js session/token encryption secret |
| `AUTH_GOOGLE_ID` | yes | Google OAuth client ID (sign-in) |
| `AUTH_GOOGLE_SECRET` | yes | Google OAuth client secret (sign-in) |
| `AUTH_URL` | yes | Canonical URL Auth.js uses for OAuth callbacks |
| `RESEND_API_KEY` | yes | Resend API key for sending emails |
| `EMAIL_FROM` | yes | "From" address for outgoing emails (verified Resend sender/domain) |
| `CRON_SECRET` | yes | Shared secret authenticating `/api/cron/poll`, `/api/ingest`, and `/api/scrape-config`; also set as a GitHub Actions repo secret |
| `APP_URL` | yes | Public base URL of the deployed app; used in email links and by the scraper to reach the API; also set as a GitHub Actions repo secret |
| `AMC_VENDOR_KEY` | no | AMC official API vendor key (`X-AMC-Vendor-Key`); unused by the current headless-scraper pipeline, kept for the legacy/direct-API adapter |
| `ADMIN_EMAILS` | no | Comma-separated emails allowed to add movies at `/movies`; leave blank for single-user mode |
| `DRY_RUN` | no | Set to `true`/`1`/`yes` when running `scraper/scrape.ts` locally to log findings without posting to `/api/ingest` |
