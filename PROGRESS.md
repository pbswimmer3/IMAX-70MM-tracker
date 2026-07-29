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
- ~~KNOWN LIMITATION: Regal drops key showDate off UTC (no queryDate)~~ FIXED 2026-07-29 —
  parseRegalPayload stamps showDate from the probe's query date (see Recent Changes).
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

## Empty-dashboard outage (2026-07-25/26) — RESOLVED 2026-07-27, THREE stacked bugs
RESOLUTION (backfill run 30226988746, main @bd98c06, FULL_SCAN=true DRY_RUN=false):
  showtimesUpserted=277, newDrops=46, digestsSent=1, errors=[], theatresMatched=2.
  83 (Metreon) + 194 (CityWalk) 70mm posted -> all 277 matched. 100% vs 0% for six days.
  NOTE matchersRepaired=0 in the INGEST response: the repair had already fired earlier in the
  same run, during that run's /api/scrape-config call (which also calls ensureBootstrapped).
  Same pattern as theatresCreated=0 on 2026-07-25. Don't misread it as "the repair didn't run".

Symptom: scraper green every 15min, 313 IMAX 70mm showtimes found, dashboard totally empty.
1. DB never seeded (schema pushed, db:seed never run against Neon) -> ingest could not resolve
   theatres. FIXED by lib/bootstrap.ts (PR #12, merged 31dbd40). Confirmed: theatresMatched=2.
2. Bug #1 was MASKING bug #3. Once theatres resolved: theatresMatched=2, activeMovies=1,
   313 posted, showtimesUpserted=0, errors=[] — silent, and the run still exited GREEN.
3. ROOT CAUSE: the Movie row "The Odyssey" was created via the /movies UI using its DEFAULT
   matcher template, which is INERT against lib/match.ts matchesMovie:
     {"amc":{"attributeCodes":["IMAX70MM","70MM"],"titlePattern":""},"regal":{...}}
   - no `movieIds` key      -> the id test cannot fire
   - `titlePattern: ""`     -> title test is guarded by length>0, so it is SKIPPED
   - `attributeCodes`       -> matchesMovie NEVER READS THIS. Dead weight in the template.
   Every branch fails => matchesMovie returns false for every showtime, forever.
   bootstrap's `movie.upsert({update:{}})` (chosen to not clobber operator edits) meant the
   broken row was skipped on every single run — the repair had to be made explicit.
FIXES: lib/match.ts isInertMatchers (encodes what matchesMovie ACTUALLY tests — notably that
attributeCodes does NOT count); bootstrap repairs the seeded slug ONLY when provably inert
(never touches other rows/fields or a working matcher set), reports `matchersRepaired`;
/api/movies 400s on inert matchers instead of silently creating a dead movie; AddMovieForm
drops attributeCodes, exposes movieIds, prefills titlePattern from the TMDB pick.
EVIDENCE (FULL_SCAN dry run 30217415618): all 285 records are
`title="The Odyssey" movieExternalId="76238" format="IMAX 70MM"|"70mm"` with real externalIds
-> scraper was always correct; the bug was entirely app-side.

## Scraper diagnostics/ops added this session
- FULL_SCAN=1 (env + workflow_dispatch input, forced false on `schedule`): ignores stored
  horizons, scans from today. REQUIRED for backfill — probeHorizon starts at storedHorizon-2,
  so today..horizon-3 is NEVER rescraped once a horizon is recorded.
- Dry run prints a 70mm breakdown: every distinct title/movieExternalId/format with counts +
  2 full sample records per group (scraper/summarize70mm.ts, pure + tested).
- concurrency: manual runs get `scrape-manual-{run_id}`; the shared `scrape` group with
  cancel-in-progress had the */15 cron KILL a 10-min FULL_SCAN 8 min in (run 30216990559).
- shouldFailRun: fails when theatresMatched>0 && activeMovies>0 && posted>0 && upserted===0.
  This signature IS bug #3; its absence is why two runs reported success while storing nothing.

## Recent Changes
- [2026-07-29] Regal horizon fix WASN'T RUNNING: home PC never pulled (branch claude/regal-dublin-imax-dates-wcggpb).
    * SYMPTOM after merging PR #16: Regal Dublin still capped, advancing exactly ONE day per day
      at local midnight (Aug 10 -> Aug 11 at 12am). That cadence is a today-relative window, NOT
      a horizon walk stopping at a real gap — old code: today+13 = Aug 11 on Jul 29 (and Aug 10
      on Jul 28, which is precisely the original report).
    * ROOT CAUSE: run-regal.cmd (REGAL-PC-SETUP.md) had NO `git pull`. The PC clones once at
      setup and never updates, so merging to main changed nothing on the only machine that
      scrapes Regal (Regal can't run on Actions — Cloudflare blocks datacenter IPs). The fix
      was correct and merged (24aadd6, regalDateRange gone from main) but simply not executing.
    * WHY IT WAS INVISIBLE: a stale scraper still logs `PASS — N showtimes`, still posts, still
      gets a healthy ingest response, and still passes the heartbeat watchdog. Nothing in any
      log distinguished "running current code" from "running months-old code".
    * FIX 1 (visibility): scrape.ts main() prints a startup banner
      `[scrape] revision=<short-sha>[-dirty] chains=… today=… dryRun=… fullScan=…`.
      NOTE the scraper package is "type":"module" — __dirname/require are UNDEFINED at runtime
      (tsx shims them only in `-e` evals, which masked this in a first pass that printed
      revision=unknown). Resolved via fileURLToPath(import.meta.url); git runs with cwd=that dir
      so it doesn't depend on the caller's cwd. Smoke-tested: prints the real sha.
    * FIX 2 (prevention): run-regal.cmd gains `git -C .. pull --ff-only` + `npm install` before
      the run. --ff-only never rewrites local work; it stops and the run continues on old code.
    * FIX 3 (security): run-regal.cmd holds APP_URL + CRON_SECRET in plaintext, lives inside the
      clone, and was NOT gitignored — now is. Matters more now that the clone is git-connected.
    * REGAL-PC-SETUP.md gains a Troubleshooting section: compare the banner sha against main;
      revision=unknown = ZIP download / no git on PATH; -dirty = local edits (also what blocks
      --ff-only). USER ACTION: `git pull` on the PC once to pick all of this up.
- [2026-07-29] Regal booking horizon truncated at 14 days (branch claude/regal-dublin-imax-dates-wcggpb).
    * SYMPTOM: Regal Hacienda Crossings ("Regal Dublin", 0347) dashboard topped out at Aug 10
      while tickets were really on sale through Aug 19 (checked manually).
    * ROOT CAUSE: scrapeRegal used a hard-coded `regalDateRange(14)` window (today..today+13).
      AMC has walked its real horizon via probeHorizon since the redesign; Regal never did.
      Today+13 = Aug 11 (Aug 10 from a Jul 28 run) — dates past that were NEVER REQUESTED.
      Parsing/ingest/matching were all fine; the scraper just never asked.
    * FIX: scrapeRegal(page, externalId, storedHorizon) now fetches ONE date per probeHorizon
      step (still an in-page same-origin fetch, so it keeps the Cloudflare clearance cookie)
      and returns observedHorizon. overshoot=3 for Regal vs AMC's 1 — a Regal date probe is one
      cheap JSON fetch, not a page load + 6 scrolls, so multi-day dark stretches no longer
      truncate the horizon. probeHorizon is now generic <T> with an optional `tag` callback
      (defaults to the existing queryDate stamping; AMC path byte-for-byte unchanged).
    * KNOCK-ON 1: Regal now reports observedHorizon → Theatre.horizonDate finally populates for
      all 4 Regal theatres (pipeline.ts:137 only writes on a string; scrapeRegal returned none).
    * KNOCK-ON 2: parseRegalPayload(payload, queryDate) stamps showDate, so Regal DropEvents key
      off the theatre's local day instead of utcDateKey(startsAt) — a 7pm PDT show was filing as
      the NEXT calendar day. Closes the old KNOWN LIMITATION above.
    * It also keeps NON-70mm records (is70mm flagged per record, like normalizeAmcRecords;
      scrape.ts filters at POST time). REQUIRED: the probe must stop on an empty DATE, not on
      "no 70mm today" — otherwise a 70mm-free Tuesday would truncate the horizon. Test guards this.
    * todayYmd() was UTC; the Regal scraper runs on a PT home PC where the UTC date rolls over at
      5 PM local, so the walk would start a day late and skip that evening. Now derived in
      America/Los_Angeles via new ymdInZone() (all 6 theatres are in CA). regalDateRange deleted.
    * NO BACKFILL NEEDED: Regal horizonDate has always been null, so the first run starts from
      today and reaches Aug 19 on its own. FULL_SCAN=1 not required.
    * TESTS 62→79. New test/parseRegal.test.ts (7) + test/scraperDates.test.ts (6) + 4 probe tests
      incl. a regression guard that a 14-day window misses a today+21 horizon. typecheck + scraper
      typecheck + next build clean; suite verified identical under TZ=UTC/New_York/LA/Tokyo.
- [2026-07-27] Dashboard sort + timezone fix (branch claude/70mm-showtimes-sort-timezone-pa1l1z).
    * BUG: showtimes rendered 7h ahead. `toLocaleString`/`toLocaleDateString` were called with no
      `timeZone`, so the *runtime's* zone won — UTC on Vercel — turning a 7:00 PM PDT show into
      2:00 AM the next day. Same defect in emails (lib/pipeline.ts formatShowtimeLabel) and in the
      "on sale through" day label (off-by-one calendar day for evening shows).
    * FIX: lib/dates.ts adds THEATRE_TIME_ZONE="America/Los_Angeles" (all 6 theatres are in CA) +
      formatShowtime(instant, {withZone}) + formatTheatreDay(instant). All UI/email wall-clock
      rendering routes through these; email labels carry the zone name ("... 7:00 PM PDT").
    * FEATURE: app/dashboard/UpcomingShowtimes.tsx (NEW, client component) — "Upcoming 70mm
      showtimes" panel extracted out of page.tsx with a date-sort toggle (asc soonest-first
      default ⟷ desc furthest-out-first). Sorts globally then regroups; theatre grouping stays in
      priority order (sort applies to dates only). page.tsx passes ISO strings, not Date objects.
    * Zone-independence is covered by tests, not by the runner's TZ: test/dates.test.ts +5 asserts
      exact PDT/PST output. Verified TZ=UTC and TZ=America/New_York → identical, 62/62 pass;
      typecheck + next build clean.
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

## Empty-dashboard fix: self-healing bootstrap (branch claude/showtimes-ui-not-populating-wyaawe)
- ROOT CAUSE (run #30169051247, 2026-07-25 18:09Z): prod Neon DB had ZERO Theatre and ZERO
  Movie rows — `prisma db push` was run, `db:seed` never was. Scraper was healthy the whole
  time (Metreon 1005/97 70mm, CityWalk 1681/218 70mm) but /api/ingest returned
  showtimesUpserted:0 + errors ["unknown theatre (AMC/AMC_METREON_TODO)", ...] every 15 min,
  and the workflow stayed GREEN. Confirmed twice over: /api/scrape-config also returned 200
  with an empty list → scraper fell back to its local list of *_TODO placeholder ids.
- lib/bootstrap.ts (NEW) ensureBootstrapped(): Theatre count 0 → createMany all 6 from
  lib/theatres.ts; non-empty → backfill showtimesUrl ONLY where null/empty (never overwrites
  operator data, never touches other fields). Movie count 0 → create Odyssey from shared
  ODYSSEY_MOVIE. Never throws; failures surface in returned errors[]. Module-level `inFlight`
  guard runs the check once per warm instance and CLEARS on rejection *or* on a resolved
  result carrying errors (otherwise a transient DB blip wedges the instance permanently).
- Called at top of /api/ingest + /api/scrape-config; result echoed as `bootstrap:{}` in both
  responses so the Actions log shows what self-healed.
- lib/theatres.ts: added shared ODYSSEY_MOVIE (prisma/seed.ts now imports it — no drift);
  AMC externalIds AMC_METREON_TODO/AMC_CITYWALK_TODO → amc-metreon-16/amc-citywalk-hollywood
  (DB keys only; scraping is DOM-based off showtimesUrl). scraper/theatres.ts kept in sync.
- LOUD FAILURE: scraper/shouldFailRun.ts (pure, tested) + scrape.ts — exit 1 when NOT a dry
  run and any of: postFailed (POST threw or !res.ok), pipeline errors[] non-empty,
  activeMovies===0, or theatresPosted>0 with theatresMatched===0. activeMovies/theatresMatched
  absent (older deployed app) = unknown, never fails. An honest zero-70mm night does NOT red.
- HARDENING (2nd pass, review of 95c239e — all were FALSE-RED or silent-green bugs in the
  hardening itself; do not reintroduce):
  * bootstrap is now UNCONDITIONALLY idempotent (createMany skipDuplicates + movie upsert
    update:{}), NOT count===0 gated. Count-gating raced (scrape-config and ingest hit
    different serverless instances, both saw count 0, loser threw P2002 → red run) and could
    never heal a partially-populated table — notably any DB still holding the old
    AMC_*_TODO ids, which has count>0 so the new slug rows would never be created.
    TRADE-OFF ACCEPTED: a deliberately-deleted seed theatre gets recreated.
  * DROPPED the old fail rule posted70mm>0 && showtimesUpserted===0. is70mm comes only from
    the AMC experience heading (parseAmc.ts, no movie involved) while ingest only upserts
    matches against an ACTIVE Movie → would have gone red every 15 min once Odyssey ends its
    run. Replaced with explicit activeMovies/theatresMatched signals from the response.
  * scrape.ts: res.ok now checked and the POST catch no longer `process.exit(allErrored?1:0)`
    early — app-down / ingest-500 / unparsable-body previously stayed GREEN (allErrored is
    false because the SCRAPES succeeded). That is the loudest failure class this change exists
    to surface.
  * /api/ingest splits errors (bootstrap+pipeline, fails the run) from notifyErrors (email
    sends, must NOT fail the run — one bouncing subscriber shouldn't red the scraper).
  * scrape.yml watchdog step got `always()`: without it any red scraper step skipped the
    heartbeat check, silently disabling Regal-PC-offline alerting.
  * lib/redact.ts: repo is PUBLIC and scrape.ts logs the whole ingest response verbatim into
    world-readable Actions logs; Prisma connection errors embed the Neon host/credentials.
    Applied at both route boundaries, to nested bootstrap.errors AND the flattened errors[].
  * lib/pipeline.ts: theatre-lookup catch now increments theatresSkipped so
    matched+skipped===inputs.length (load-bearing for the theatresMatched===0 fail rule).
- /api/ingest response: theatresIngested (counted POSTs, read like success) → theatresMatched
  + theatresSkipped, sourced from ingestAndDetect's return, not error-string matching.
- TESTS: 27 pass (was 19). test/bootstrap.test.ts (empty DB / populated no-op / partial
  backfill, prisma mocked via vi.doMock + resetModules to defeat the guard);
  test/shouldFailRun.test.ts (5 cases). typecheck + scraper tsc clean.
- EXPECTED AFTER MERGE TO MAIN: next */15 run logs theatresCreated:6/moviesCreated:1, then
  showtimesUpserted in the hundreds; dashboard populates within ~15 min. If not, run goes RED.

## Last Session
- Status: AMC PIPELINE IS LIVE END-TO-END. Empty-dashboard outage resolved (see section above).
  PRs #12 (bootstrap) + #13 (matcher repair + FULL_SCAN + diagnostics) merged to main @bd98c06.
  Backfill run 30226988746 stored 277 showtimes / 46 drops / 1 digest email.
- OPEN / NOT DONE:
  * Regal still deferred (4 theatres seeded but never scraped; SCRAPE_CHAINS=AMC on Actions).
    parseRegal.ts still UNVERIFIED — needs one real payload from a residential IP.
  * Vercel envs ALERT_EMAIL / HEARTBEAT_STALE_MINUTES: unconfirmed. heartbeat-check returns
    {"checked":0} every run, i.e. no SourceHealth rows yet (expected while Regal is off).
  * A future FULL_SCAN backfill is needed after ANY matcher/parser fix — probeHorizon resumes
    from storedHorizon-2, so the current window never re-scrapes itself. Use the workflow's
    full_scan input (manual runs now get their own concurrency group, so the cron can't kill them).
- Verified: 2026-07-27 — 277/277 posted 70mm showtimes matched and stored; errors=[] ;
  typecheck + 57 vitest tests + scraper tsc clean.
- Exit: clean
- Rollback: main @bd98c06. Pre-outage-fix main = 473298d.

## This Session (2026-07-27, branch claude/70mm-showtimes-sort-timezone-pa1l1z)
- Done: dashboard date-sort toggle + Pacific-timezone rendering fix (see Recent Changes head entry).
  Files: lib/dates.ts, lib/pipeline.ts, app/dashboard/page.tsx, app/dashboard/UpcomingShowtimes.tsx (new),
  test/dates.test.ts.
- Verified: typecheck clean, next build clean, 62/62 vitest under TZ=UTC and TZ=America/New_York.
- NOTE: no schema/scraper change — stored startsAt instants were always correct; this was
  display-only. No re-scrape or backfill needed.
- Exit: clean
- Rollback: main @bd98c06.
