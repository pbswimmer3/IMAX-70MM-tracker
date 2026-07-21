# Running the Regal scraper on your always-on Windows PC

Regal's showtimes sit behind Cloudflare's managed challenge, which blocks
datacenter IPs (GitHub Actions, Vercel) but passes from a **residential IP**.
So Regal is scraped from your home PC, while **AMC keeps running on GitHub
Actions** (AMC is not blocked). The same `scraper/scrape.ts` handles both — the
`SCRAPE_CHAINS` env var picks which chains a run does.

This guide sets up a scheduled task that scrapes only Regal every 15 minutes and
posts to the app. It also enables offline/blocked email alerts (below).

## What runs where

| Source          | Scrapes | Where            | Trigger                    |
|-----------------|---------|------------------|----------------------------|
| GitHub Actions  | AMC     | cloud (datacenter) | `*/15` schedule (existing) |
| Your Windows PC | Regal   | home (residential) | Task Scheduler, every 15m  |

## One-time: create the `SourceHealth` table

The heartbeat/alert feature adds a `SourceHealth` model. Apply it to your
Neon/Postgres DB once (from the repo, with `DATABASE_URL` set):

```
npx prisma db push
```

## One-time: app env vars (Vercel → Project → Settings → Environment Variables)

- `ALERT_EMAIL=pradbiswas@gmail.com` — where alerts go.
- `HEARTBEAT_STALE_MINUTES=45` — minutes without Regal data before "PC offline".

(`GMAIL_USER` / `GMAIL_APP_PASSWORD` are already set — alerts reuse them.)
Redeploy so the new `/api/cron/heartbeat-check` route and env vars go live.

## PC setup (Windows)

1. **Install Node.js 20+** (https://nodejs.org) and **Git**.
2. **Clone the repo** and install the scraper deps + a browser:
   ```
   git clone https://github.com/pbswimmer3/IMAX-70MM-tracker.git
   cd IMAX-70MM-tracker\scraper
   npm install
   npx playwright install chromium
   ```
3. **Make a run script** `run-regal.cmd` in the `scraper` folder (fill in the
   two secrets — same values as the app's `APP_URL` and `CRON_SECRET`):
   ```bat
   @echo off
   cd /d %~dp0
   set SCRAPE_CHAINS=REGAL
   set APP_URL=https://YOUR-APP.vercel.app
   set CRON_SECRET=YOUR_CRON_SECRET
   set DRY_RUN=false
   npx tsx scrape.ts >> regal.log 2>&1
   ```
   Test it once by double-clicking; check `regal.log` for
   `PASS — N showtimes` lines and an `ingest response`. To eyeball results
   without posting, set `DRY_RUN=true` for a run.

4. **Schedule it every 15 minutes** (Task Scheduler):
   - Open **Task Scheduler → Create Task** (not "Basic Task").
   - General: name it "Regal scraper"; check **Run whether user is logged on or
     not** and **Run with highest privileges**.
   - Triggers → New: **On a schedule → One time**, then check **Repeat task
     every 15 minutes** for **Indefinitely**.
   - Actions → New: **Start a program** → Program = the full path to
     `run-regal.cmd`.
   - Conditions: uncheck "Start the task only if the computer is on AC power"
     (so it runs on your media PC regardless).
   - Save (you'll be asked for your Windows password because of "run whether
     logged on or not").

That's it — Regal showtimes will start flowing into the same dashboard as AMC.

## Offline / blocked email alerts

The app's watchdog (`/api/cron/heartbeat-check`) is called every run by the
**GitHub Actions** workflow — which stays up even when your PC is off, so it can
detect outages. It sends **one email per outage** plus a **recovery email**:

- **"Regal feed down — gaming PC appears offline"** — no Regal heartbeat for
  `HEARTBEAT_STALE_MINUTES` (default 45). Your PC is off/asleep/offline.
- **"Regal is blocking the scraper (Cloudflare)"** — your PC is posting, but
  Regal returned a challenge instead of showtimes (Regal changed something or
  your IP got flagged).
- **"Regal feed recovered"** — real Regal data is arriving again.

Each fires once on the transition (no repeat spam), to `ALERT_EMAIL`.

## Notes / caveats

- `scraper/parseRegal.ts` was written from best-effort field names and has
  **not** been validated against a real Regal `getShowtimes` payload. On the
  first live run, check `regal.log`: if Regal PASSes but shows 0 showtimes for a
  theatre that clearly has them, dump one payload and adjust `parseRegal.ts`.
- Keep the PC awake: Settings → System → Power → Sleep = Never (or allow the
  scheduled task to wake it).
