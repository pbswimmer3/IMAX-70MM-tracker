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
