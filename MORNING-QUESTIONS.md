# Morning handoff — 2026-07-21 (updated after live diagnosis)

I triggered a live run and dug into why the UI is empty. Good news up front:
**your env vars/secrets are correct and the whole pipeline works** — the empty
UI is a scraper bug, now fully diagnosed with evidence. Details + questions below.

---

## 1. Why the workflow "isn't running" — DIAGNOSED

**Where to watch runs:** GitHub repo → **Actions** tab → "Scrape showtimes".

**What I did:** triggered a live run (`workflow_dispatch`, run #8). It succeeded
end-to-end:
`ingest response: {"theatresIngested":2,"showtimesUpserted":0,"newDrops":0,"errors":[]}`
→ so `APP_URL` + `CRON_SECRET` are set correctly, auth works, the DB write path
works, emails would send. **Nothing is wrong with GitHub secrets or the pipeline.**

**The real reason the UI is empty** (found via 6 dry-run diagnostic iterations —
all reverted, scraper is back to clean): **two scraper bugs against AMC's site.**

1. **The scraper only loads AMC's default "today" view.** The schedule fires every
   15 min in UTC, i.e. through the small hours Pacific. At ~2 AM PT every movie
   shows *"No remaining showtimes today — Try Tomorrow."* So the scraper correctly
   sees zero. (This morning's success was a dry-run at ~8 PM PT, when today still
   had showtimes.) The scraper never looks at future dates, so nighttime runs =
   nothing, and daytime runs only catch what's left of *today*.

2. **AMC redesigned the showtimes page.** Showtimes now render in a lazy,
   scroll-triggered section, and the old fields the parser keyed on
   (`showtimeId`, `showDateTimeUtc` in the RSC payload) are **gone**. So even on a
   day with showtimes, the current parser extracts 0.

**Proof it's fixable & AMC is NOT blocking us:** loading a *future* date and
scrolling renders everything from the GitHub datacenter IP. I captured The Odyssey
with real IMAX 70mm showtimes:
> "The Odyssey … **IMAX 70MM: EXTRAORDINARY AWAITS** … 6:05am … 10:00pm …
> **PRIME at AMC** … **70mm: GREATER DETAIL AND DEPTH** …"

So AMC data is fully reachable on GitHub Actions — the scraper just needs updating.

**The `*/15` schedule:** as of my checks it still hadn't auto-fired on its own
(GitHub is slow to start schedules on brand-new repos), but that's moot right now —
until the parser is fixed, every run ingests 0. Once fixed it should catch up.
Per your note, I left the schedule at `*/15` (no relaxing).

### The fix (a real scraper rewrite — I did NOT ship it without your OK)
It's a systemic change and it's safety-critical (get 70mm detection wrong and the
app fails its one job), so I spec'd it precisely instead of guessing. New approach:
- **Iterate future dates:** load `?date=YYYY-MM-DD` for ~14 days, not just today.
- **Scroll to render, then parse the DOM** (RSC parsing is dead):
  - movie = `<section id="{slug}-{movieId}">` (e.g. `the-odyssey-76238`)
  - showtime = `<a href="/showtimes/{id}"><time datetime="{UTC ISO}">` → gives a
    clean per-showtime booking URL (`amctheatres.com/showtimes/{id}`) + exact UTC start
  - **70mm flag = the experience-group heading** the showtime sits under contains
    `70mm`/`IMAX 70MM` (format is in the heading, not the link).
- One detail I still need to confirm before trusting it: the exact DOM container
  that groups showtimes under each format heading (so each time is attributed to
  the right format). I have the loop to validate this in 1–2 dry-runs.

**Q1. Want me to build this AMC parser rewrite?** It's the actual fix for your
empty UI. (~adds 1–2 min/run to iterate dates; fine for a 15-min schedule.)

---

## 2. "Last day showtimes available" on the dashboard — ✅ BUILT
Per-movie line: `70mm on sale through <furthest date> · last found <date>`, with a
`No 70mm showtimes found yet` fallback. Compiles clean. You said you'll test it.
(Only nuance: I show the furthest on-sale date; say if you'd rather have a
"last scraped N min ago" freshness stamp instead/also.)

---

## 3. Regal via the Windows PC + offline email alerts

**Important update from the diagnosis:** **AMC does NOT need the PC.** It renders
fine from the GitHub datacenter — it was never IP-blocked (just the two bugs
above). **Only Regal** needs a residential IP (Cloudflare blocks datacenter IPs).

So your rule — *"run both on PC only if GitHub is finicky/dropping runs; otherwise
just run the proxy on PC"* — resolves cleanly: **GitHub is NOT dropping runs (they
execute fine), so → keep AMC on GitHub Actions, run only Regal from the PC.**

**Q2. Confirm: AMC stays on GitHub Actions, PC handles only Regal?** (This is what
your stated rule implies; just confirming since the "AMC is blocked" premise turned
out to be false.)

**Proposed Regal-on-Windows setup** (pending Q2):
- A small Node + Playwright scraper on the PC (Windows Task Scheduler, every 15 min)
  that scrapes only the 4 Regal theatres from your home IP and POSTs to `/api/ingest`
  — same endpoint, same `CRON_SECRET`. No inbound ports / no exposing the PC.
- (Alternative "proxy" model = PC runs a proxy and GitHub routes Regal through it;
  more moving parts + exposes a port. The self-contained scraper above is simpler
  and I'd recommend it unless you specifically want the proxy model.)

**Q3. Self-contained Regal scraper on the PC (recommended), or literally a network
proxy the GitHub job dials into?**

**Offline/heartbeat alerts (every 45 min, two distinct causes → email
pradbiswas@gmail.com):** the watchdog runs on GitHub Actions (it stays up even when
your PC is off), checking whether fresh Regal data landed. It distinguishes:
- **(a) "PC offline / Regal scraper not running"** — no Regal data received at all
  in the last 45 min (your PC is off, asleep, or lost network).
- **(b) "Regal is Cloudflare-blocking"** — the PC is posting but reporting Regal
  came back as a challenge (Regal changed something / IP flagged).
Two different emails so you know whether to go turn your PC back on vs. investigate
Regal. I'll implement this alongside the Regal work.

**Q4. Alert policy:** one email per outage then silent until it recovers (+ a
"back online" email), or a repeat every 45 min while it's down? (I'd default to
one-per-outage + recovery notice.)

**Heads-up (not a question):** the existing `scraper/parseRegal.ts` was written from
*guessed* field names and has never been validated against a real Regal payload.
Once the PC is scraping, I'll need one real `getShowtimes` JSON dump from it to
finalize that parser before Regal data can be trusted.

---

## Summary of what changed tonight
- ✅ Change #2 built & committed (dashboard availability line).
- ✅ Change #1 fully diagnosed via a live run + 6 reverted dry-run probes; pipeline
  & secrets confirmed healthy; real cause = AMC "today-only + redesigned page".
  Fix spec ready, awaiting your go (Q1).
- ⏸️ Change #3 planned; needs Q2–Q4. Regal parser needs a real payload to verify.
- Branch `claude/session-tnklc6` pushed. No live emails sent to anyone (run #8 found
  0 showtimes, so no drop emails went out).
