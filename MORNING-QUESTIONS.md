# Morning handoff — 2026-07-21

Three requests: (1) diagnose why the scraper workflow isn't running, (2) show the
last day showtimes are available on the UI, (3) implement Regal via your always-on
gaming PC + email alerts when it goes offline. Below: what I found, what I built,
and the questions I need answered to finish.

---

## 1. Why the GitHub workflow isn't running

**Where to watch it:** GitHub repo → **Actions** tab → "Scrape showtimes" workflow.
That page lists every run (scheduled, manual, push) with logs. Right now it shows
only 7 old runs.

**What I found (verified via the GitHub API):**
- The workflow IS correctly on `main`, state = `active`, with the `*/15` schedule.
  Nothing is wrong with the YAML or the code.
- **Zero scheduled runs have ever fired.** All 7 runs in history are old `push`
  dry-runs on the retired feature branch — and because they were dry-runs, none
  ever POSTed to `/api/ingest`. So the database was never populated. That alone
  explains "no showtimes on the UI."
- The live schedule only landed on `main` at ~06:14 UTC (PR #5), ~2h before I
  looked. GitHub's scheduler is notoriously slow/unreliable for short `*/15`
  crons — first fire on a brand-new repo (this repo is <12h old) is often delayed
  20-40+ min, and sub-hourly runs get silently dropped under load. So "zero so
  far" is partly just GitHub being GitHub, but 2h with nothing is on the long side.

**Two independent things must be true for showtimes to appear**, and I can't verify
either from here:
- (a) A scheduled run actually fires (GitHub's flaky scheduler).
- (b) The repo secrets `APP_URL` and `CRON_SECRET` are set **and** `CRON_SECRET`
  exactly matches the one in Vercel. If they're missing/mismatched, runs will
  execute but the POST to `/api/ingest` 401s and still no showtimes.

### Questions
1. **Want me to trigger a manual live run now?** (Actions → Run workflow, dry_run
   off.) This is the fastest way to (a) prove the whole pipeline works end-to-end
   and (b) populate showtimes immediately instead of waiting on GitHub's scheduler.
   ⚠️ If it works, it will send real "drop" emails to anyone subscribed (probably
   just you). I did **not** do this overnight without your OK.
2. **Are the two repo secrets `APP_URL` + `CRON_SECRET` set?** (Settings → Secrets
   and variables → Actions.) And does `CRON_SECRET` exactly match Vercel's env var?
3. **Want me to relax the schedule to `*/20` or `*/30`?** Every-15 is the cadence
   GitHub is most likely to skip. Slightly slower but fires more reliably.

---

## 2. "Last day showtimes are available" on the UI  — ✅ BUILT (confirm intent)

Committed a dashboard change: each movie in the Movies panel now shows a line like

> **The Odyssey** — 70mm on sale through Aug 12, 2026 · last found Jul 21, 2026

- "on sale through" = the furthest-out date a 70mm showtime currently exists
  (max `startsAt`). This reflects how far ahead tickets are on sale.
- "last found" = when the scraper most recently discovered a *new* showtime for
  that movie (max `firstSeenAt`).
- Movies with no 70mm showtimes show "No 70mm showtimes found yet."

It compiles clean (`tsc --noEmit` passes). It'll render blank/"none" until real
data flows in (see #1).

### Questions
4. Did you mean **(a) the furthest-out on-sale date** (what I built) or **(b) a
   freshness stamp** ("last successful scrape 12 min ago")? Easy to switch or show
   both more prominently.
5. Placement OK in the Movies panel, or would you rather it headline the "Upcoming
   70mm showtimes" panel?

---

## 3. Regal via your always-on gaming PC + offline email alerts

**Short answer: yes, your always-on PC is exactly the right fix.** Regal's pages
sit behind Cloudflare's managed challenge, which blocks datacenter IPs (GitHub
Actions, Vercel) but passes from a residential IP — which is why Regal already
works when run from home. The Regal scraping code is already written and wired
(currently skipped); the only blocker has always been "needs a residential IP."

**Recommended architecture** (pending your answers):
- Run the **full scraper on the PC** on a 15-min schedule (Windows Task Scheduler
  or cron), POSTing to `/api/ingest` — same endpoint GitHub Actions uses. No
  inbound ports, no proxy server, no exposing your PC to the internet.
- The PC becomes the single source of truth for both chains; I'd then turn off the
  GitHub Actions schedule to avoid double-scraping.
- **Offline/heartbeat alert:** the cleanest watchdog is to keep a tiny GitHub
  Actions job running every 15 min whose ONLY job is to ask the app "have you
  received a Regal scrape in the last N minutes?" and email you if not. GitHub
  Actions stays up even when your PC is off, so it can reliably detect the outage.
  (Vercel's own cron can't do this well — Hobby plan allows only 1 cron run/day.)

**One hard dependency:** `scraper/parseRegal.ts` was written from *guessed* field
names — Regal's getShowtimes JSON is undocumented and has never been validated
against a real payload. Once the PC is scraping, I'll need **one real JSON dump**
from it to finalize the parser before Regal data can be trusted.

### Questions
6. **What OS is the gaming PC?** (Windows / Linux / macOS) — determines the
   scheduler and setup steps.
7. **Full scraper on the PC** (recommended, simplest) **or** run just a proxy on
   the PC and keep scraping on GitHub Actions? Full-scraper-on-PC needs no inbound
   network exposure.
8. Should the PC scrape **both AMC + Regal** (then I disable the GitHub schedule)
   or **only Regal** (GitHub keeps doing AMC)? Both-from-home is simpler to reason
   about.
9. **Alert cadence/policy:** what staleness threshold should trigger the email
   (e.g. no Regal data for 45 min)? One alert per outage, or repeated until it
   recovers? Send a "back online" email when it recovers?
10. Should the alert distinguish **"PC is off / scraper not running"** from
    **"Regal specifically got Cloudflare-blocked"**? (Different problems: the first
    means turn your PC back on; the second means Regal changed something.)
11. Send alerts to **pradbiswas@gmail.com** (your login), or a different address?

---

### What I did NOT do overnight (waiting on you)
- Did not trigger any live workflow run (would email subscribers) — see Q1.
- Did not write Regal/heartbeat code — too many unknowns above; it's a systemic
  change and our convention is plan-first. I'll build it fast once you answer 6-11.
