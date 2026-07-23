# PROJECT STATE
## Stack
- Frontend: Next.js 14 (App Router, TS)
- Backend/DB: Vercel serverless + Postgres (Neon) via Prisma; Auth.js v5 (Google); Gmail SMTP email (nodemailer)
- Ingestion: Playwright headless-browser scraper in `scraper/`, run by GitHub Actions (.github/workflows/scrape.yml), POSTs to /api/ingest
- Infra: Vercel Hobby (deployed) + GitHub Actions (public repo = free unlimited minutes)

## Current
- Objective: IMAX 70mm showtime-drop tracker. 2 AMC theatres LIVE; 4 Regal DEFERRED.
- Branch: claude/imax-70mm-tracker-redesign-2i2ocs (redesign). App deployed on Vercel by user.
- Status: prior branch klhyd0 (PR #1) superseded by the horizon redesign below.

## Redesign: booking-horizon tracker + per-date digest (this branch)
- WHY: fixed 14-day AMC rescan = 14 page loads/theatre/run (flaky); one-shot DropEvent
  (@@unique[movieId,theatreId]) fired once ever, didn't model "new day dropped".
- Scraper (scraper/probe.ts probeHorizon): per theatre, start at max(today, storedHorizon-2),
  walk forward one date at a time, stop 1 day past the first EMPTY (any-format) date (overshoot=1,
  fills single-day gaps, resets streak on a later non-empty day); hard cap 60d. Common case 1-3
  loads vs 14. observedHorizon POSTed back → Theatre.horizonDate; fed to next run via /api/scrape-config.
- Detection (lib/pipeline.ts ingestAndDetect): per-date DropEvents. DropEvent now
  @@unique[movieId,theatreId,showDate] + showDate + notifiedAt. showDate = scraper's queryDate
  (AMC) / utcDateKey fallback (Regal). Creates a DropEvent per newly-seen 70mm date.
- Notify (sendDropDigest): ONE digest email/user/run over drops with notifiedAt=null
  (lib/digest.ts buildDigests), then stamps notifiedAt on all pending (idempotent, at-most-once).
- DEAD-BUT-KEPT (intentional): sendDropEmails/processReminderPass + Reminder model + /api/dismiss
  + /api/cron/poll are now inert (digest replaces the 3x hourly nudge). Left intact to avoid a
  destructive migration; remove in a follow-up if the nudge/dismiss flow is truly unwanted.
- KNOWN LIMITATION: Regal drops key showDate off UTC (no queryDate); Regal is IP-deferred so N/A now.
- TESTS/CI: Vitest (test/, 19 tests) on pure modules probeHorizon/dates/digest/is70mmFormat.
  .github/workflows/test.yml runs on pull_request + push: npm ci → prisma generate → tsc → vitest
  → scraper typecheck. Root scripts: test, typecheck.

## Data-source history (why the current design)
- AMC official API: REJECTS vendor keys (HTTP 403 "Unauthorized VendorKey"). Dead.
- Regal getShowtimes API: Cloudflare 403 even from residential IP. Dead as bare fetch.
- Both /showtimes PAGES load in a real browser → headless-browser scraper chosen.
- AMC pages load fine from GitHub Actions datacenter IPs. Regal pages hit Cloudflare
  "Attention Required" managed challenge from datacenter IPs (0/4 cleared, 3 retries).

## AMC (LIVE, validated in CI)
- AMC is Next.js App Router; showtimes are in the streaming RSC payload (self.__next_f).
- `scraper/parseAmc.ts`: decodeNextFlight() decodes __next_f chunks; parseAmcRsc() regex-
  extracts each showtime (showtimeId, showDateTimeUtc) + aria-describedby. First aria token
  = `{slug}-{movieId}` (movie). Second token embeds format codes → is70mm via /imax70mm|70mm/.
- CI dry-run detected The Odyssey IMAX 70mm at BOTH Metreon(#1) + CityWalk(#3), movie id 76238.
- Matcher (prisma/seed.ts) Odyssey: amc.movieIds ["76238","80679"] + titlePattern "odyssey".
  matchesMovie requires is70mm=true, so standard-format Odyssey showtimes are correctly ignored.
- bookingUrl falls back to the theatre /showtimes page (no per-showtime purchase URL in RSC).

## App (built, builds, reviewed)
- Auth.js Google (auth.ts). Prisma schema: User/Account/Session, Theatre(+showtimesUrl),
  Movie(matchers JSON), Subscription, Showtime, DropEvent, Reminder.
- lib/pipeline.ts: ingestAndDetect / sendDropEmails / processReminderPass (record-intent-
  before-send; cap 3; hourly; !dismissed; theatreId null = all-theatres sub).
- Routes: /api/ingest (Bearer CRON_SECRET; scraper posts here), /api/scrape-config,
  /api/cron/poll (reminder-only), /api/dismiss (HMAC token), /api/subscriptions, /api/movies
  (ADMIN_EMAILS gate + matcher validation).
- Emails (lib/email.ts): Footage Counter (drop) + Safelight (reminders). Design lab artifact
  in design/notifications.html.

## GO-LIVE remaining (user)
1. Merge PR #1 to main → activates the */15 schedule.
2. Ensure Vercel env + GitHub repo secrets APP_URL & CRON_SECRET are set (SETUP.md steps 6-7).
3. Optional immediate run (Odyssey 70mm may already be showing): after merge, trigger
   workflow_dispatch (dry_run unchecked); OR run locally now:
   `cd scraper && npm i && npx playwright install chromium && APP_URL=<vercel> CRON_SECRET=<secret> DRY_RUN=false npx tsx scrape.ts`

## ===== HANDOFF: RE-ENABLING REGAL (do in a future chat) =====
Goal: add the 4 Regal theatres (#2 Hacienda 0347, #4 Irvine 1010, #5 LA Live 1484,
#6 Ontario 1026). Everything is coded and skipped; the ONLY blocker is IP reputation.

WHY BLOCKED: Regal's /showtimes pages + /api/getShowtimes are behind Cloudflare's managed
challenge, which blocks datacenter IPs (GitHub Actions, Vercel). Confirmed 0/4 in CI even
with a 3-attempt reload loop. A real browser from a RESIDENTIAL IP passes (that's why the
local dry-run works from home).

FIX (required — un-skipping alone will NOT work from GitHub Actions):
Route Regal page loads through a residential IP. Two options:
  A) Residential proxy (keeps hosting on GitHub Actions). Providers: IPRoyal / Webshare /
     Bright Data (~$5-15/mo; this is tiny volume, a few HTML pages every 15 min). Apply per
     Playwright context in scraper/scrape.ts `scrapeTheatre()`:
        browser.newContext({ ..., proxy: { server, username, password } })  // for REGAL only
     Read proxy creds from env (e.g. REGAL_PROXY_URL) set as a GitHub secret.
  B) Run the scraper on a residential machine / always-on device (cron/launchd) instead of
     GitHub Actions. $0 but needs the machine on. Local dry-run already reaches Regal.

CODE TO CHANGE:
  - scraper/scrape.ts, main() loop: REMOVE the `if (theatre.chain === "REGAL") { ...continue }`
    skip block (search "deferred (Regal blocked").
  - scraper/scrape.ts, scrapeTheatre(): add the proxy to newContext (option A).
  - scraper/scrape.ts already has scrapeRegal(): loads the theatre page (to get the CF
    clearance cookie), then in-page fetches /api/getShowtimes for 14 dates, parses via
    scraper/parseRegal.ts.

VALIDATE (parseRegal.ts is UNVERIFIED — field names are best-effort guesses):
  - Regal getShowtimes JSON shape is undocumented. Before trusting output, add a diagnostic
    dump of the first non-empty payload (like the [amc2] dumps we used) and confirm the keys:
    movies array (movies|results|data|films), per-movie title + hoCode, performances array,
    per-performance start time / bookingUrl / experience-format label. Fix parseRegal.ts to match.
  - 70mm detection: hoCode ho00019076 or ho00021807, or experience/title contains "70mm".
    Seed matchers.regal.hoCodes already = ["ho00019076","ho00021807"] + titlePattern "odyssey".
  - Iterate using the same CI dry-run loop (push to a dev branch with a temporary push trigger,
    read logs via GitHub Actions tools), but note the proxy secret must be present for Regal to clear.

DASHBOARD (optional polish): the 4 Regal theatres are seeded and show in the app but never
get showtimes until re-enabled. Consider an `enabled` flag on Theatre to label them
"not yet monitored" so users aren't misled.

## Recent Changes
- [2026-07-21] Change #3 BUILT: Regal-on-PC scraping + heartbeat alerts. scraper SCRAPE_CHAINS filter (AMC on Actions / REGAL on home PC; replaces hard Regal skip) + posts sourceHealth heartbeat. New SourceHealth model; lib/heartbeat.ts (recordHeartbeat + checkHeartbeats: 1 alert/outage + recovery, 45min stale); /api/ingest records heartbeat; /api/cron/heartbeat-check watchdog (called every run by AMC workflow); lib/email.ts sendAlertEmail (offline/blocked/recovered); scraper/REGAL-PC-SETUP.md (Windows Task Scheduler). Full next build + tsc PASS. NEEDS: `npx prisma db push` on Neon; Vercel ALERT_EMAIL/HEARTBEAT_STALE_MINUTES; PC setup. parseRegal.ts still UNVERIFIED (needs 1 real payload from PC).
- [2026-07-21] Change #1 FIXED + VALIDATED: rewrote AMC scraper (parseAmc.ts DOM-based + scrapeAmc date-iteration/scroll). CI dry-run: Metreon 769 showtimes/52 70mm, CityWalk 1088/161 70mm over 14/14 dates; 70mm detection correct (Odyssey IMAX 70MM=true; RealD 3D/Laser/Standard=false). AMC NOT blocked; stays on Actions.
- [2026-07-21] dashboard/page.tsx: added per-movie 70mm availability line ("on sale through <maxDate> · last found <firstSeenAt>"); groupBy query. tsc clean. (Change #2) — BUILT
- [2026-07-21] Change #1 DIAGNOSED via live run #8 + 6 reverted dry-run probes (all diagnostics reverted; scraper clean):
    * Secrets/pipeline CONFIRMED WORKING: ingest returned {theatresIngested:2, errors:[]}. Not a secrets/scheduler problem.
    * REAL cause of empty UI = TWO AMC scraper bugs: (1) scraper only loads default "today" view; runs fire overnight PT when AMC shows "No remaining showtimes today"; never iterates future dates. (2) AMC redesigned page: old RSC fields showtimeId/showDateTimeUtc GONE; showtimes now lazy/scroll-rendered in DOM.
    * PROVEN reachable from datacenter: future date + scroll renders Odyssey w/ IMAX 70MM showtimes. AMC is NOT IP-blocked → stays on GitHub Actions. Only REGAL needs residential IP.
    * NEW AMC DOM schema (for the fix): movie=<section id="{slug}-{movieId}">; showtime=<a href="/showtimes/{id}"><time datetime="UTC ISO">; 70mm flag from experience-group HEADING text (/70mm|IMAX 70MM/); per-showtime bookingUrl now = amctheatres.com/showtimes/{id}.
    * FIX NOT SHIPPED (systemic + 70mm-detection-critical; needs user OK): rewrite scrapeAmc to iterate ?date=YYYY-MM-DD ~14d + scroll + DOM parse; rewrite parseAmc to DOM-based. Open detail: exact DOM container grouping times under each format heading (validate in 1-2 dry-runs).
- [2026-07-21] MORNING-QUESTIONS.md rewritten with true diagnosis + Qs: Q1 build AMC parser rewrite? Q2 confirm AMC-on-Actions/Regal-on-PC? Q3 self-contained Regal scraper vs proxy? Q4 alert policy (45min, 2 causes, email pradbiswas@gmail.com). parseRegal.ts still UNVERIFIED (needs real payload from PC).
- [2026-07-21] scrape.yml: flipped to live (removed temp push trigger; schedule */15; dispatch dry_run default false)
- [2026-07-21] parseAmc.ts rewrite + scrape.ts: AMC RSC parser validated; detects Odyssey 70mm at both AMC theatres
- [2026-07-21] scraper: Regal skipped (deferred); SETUP.md/README rewritten for scraper architecture
- [2026-07-21] app: full pipeline (auth/DB/ingest/emails/reminders/dashboard) built, reviewed, builds

## Last Session
- Status: ALL 3 CHANGES BUILT on claude/session-tnklc6. #1 (AMC parser) validated live in CI. #2 (dashboard) built. #3 (Regal-on-PC + alerts) built, tsc+build pass (can't runtime-test w/o PC+DB migration).
- USER TODO to go live: (1) merge claude/session-tnklc6 → main (activates AMC fix on the */15 schedule + deploys new routes). (2) `npx prisma db push` for SourceHealth table. (3) Vercel envs ALERT_EMAIL=pradbiswas@gmail.com, HEARTBEAT_STALE_MINUTES=45. (4) Set up PC per scraper/REGAL-PC-SETUP.md (SCRAPE_CHAINS=REGAL). (5) Verify parseRegal.ts vs a real payload from the PC.
- Verified: 2026-07-21 — AMC CI dry-run detects Odyssey 70mm at both theatres; `next build` + `tsc --noEmit` clean (app+scraper).
- Exit: clean
- Rollback: pre-change HEAD = 25a11ca (main). Changes are separate commits on claude/session-tnklc6.
