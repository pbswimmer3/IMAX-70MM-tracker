import { daysBetweenYmd } from "./theatres";

// Pure, browser-free Regal decision logic + the constants it depends on.
// Deliberately imports NOTHING that pulls in playwright (see scrape.ts's
// top-level `import { chromium } from "playwright"`) — that import chain is
// what previously dragged playwright into `next build`'s type-check graph
// via test/scrapeRegal.test.ts, since root deps (playwright lives only in
// scraper/package.json) aren't installed for that build. Keep it that way:
// this module must stay free of playwright/browser imports.

// A Regal date probe is ONE same-origin JSON fetch, versus AMC's full page load
// + 6 scroll passes. That much lower per-date cost is why Regal tolerates a
// longer run of empty days before declaring the booking window over: a midweek
// dark day (or a 2-3 day gap between engagements) must not truncate the horizon.
// (REGAL_OVERSHOOT itself stays in scrape.ts since no test imports it.)

// How many dates forward the Regal walk may probe before giving up on finding
// the end of the booking window. The shared default of 60 was NOT enough:
// measured 2026-07-29, Hacienda Crossings and Irvine Spectrum both stopped at
// exactly today+59 with showtimes still on sale, and reported that cut-off as
// their horizon. A Regal date costs ~0.9s including pacing, so raising this is
// cheap: the full 4-theatre run measured 4m06s at 60.
export const REGAL_MAX_FORWARD = 120;

// Regal enforces a request quota of ~25 per BROWSER SESSION on the
// getShowtimes endpoint (measured live 2026-07-29): requests 1-25 on a
// session succeed in 130-900ms; request 26+ on that SAME session hangs until
// our timeout, forever — and retrying the same date on the same session
// fails again. A FRESH browser context (new page load + Cloudflare
// clearance) requesting the exact same date succeeds in ~142ms. This is a
// per-session quota wall, not the end of the booking window — every
// "horizon" this scraper previously reported at date #25/#26 was this wall
// being mistaken for the real horizon. Do NOT raise this back toward 25:
// it's a deliberate safety margin under the measured cliff.
export const REGAL_MAX_REQUESTS_PER_SESSION = 20;

// Pure decision helper (unit-testable without a browser): should the walk
// rotate to a fresh session BEFORE issuing the next request on this one?
export function shouldRotateRegalSession(requestsOnSession: number, max: number): boolean {
  return requestsOnSession >= max;
}

// Substrings of a TRANSPORT_FAIL reason that mean the whole browser/session is
// dead, not that this one date's request merely timed out. Measured
// 2026-08 outage: after "Target crashed"/"has been closed", every remaining
// date in the walk failed in ~1ms and the theatre reported PASS with 0
// showtimes — indistinguishable from a genuinely empty booking window. A
// fresh CONTEXT on a crashed browser does not recover (one date worked, then
// the browser was gone) — only relaunching the whole Browser does.
const REGAL_FATAL_ERROR_SUBSTRINGS = [
  "Target crashed",
  "has been closed",
  "Target closed",
  "browser has been closed",
  "Protocol error",
];

export function isFatalRegalTransportError(reason: string): boolean {
  return REGAL_FATAL_ERROR_SUBSTRINGS.some((s) => reason.includes(s));
}

// Overall wall-clock budget for the whole Regal phase of a run (all
// theatres), measured from when Regal scraping starts. The existing
// REGAL_WALK_DEADLINE_MS (6 min) is PER THEATRE, so four theatres can reach
// 24 min — past the 15-min Task Scheduler tick and into its 30-min kill.
// Once this budget is exhausted, remaining theatres are skipped (not
// scraped at all) so the run can still POST whatever it already collected
// instead of being killed with nothing.
export const REGAL_RUN_DEADLINE_MS = 10 * 60 * 1000;

export function isRegalRunBudgetExhausted(
  elapsedMs: number,
  deadlineMs: number = REGAL_RUN_DEADLINE_MS
): boolean {
  return elapsedMs >= deadlineMs;
}

// How many days past a theatre's previously-observed horizon a run's walk is
// allowed to advance. Regal's booking window advances roughly 1 day per day,
// so 7 comfortably outpaces it while letting the far edge of the walk stay
// far shorter than REGAL_MAX_FORWARD (120) on every run after the first.
export const REGAL_HORIZON_LOOKAHEAD = 7;

// Bounds a single run's walk to the known horizon plus a small lookahead
// instead of re-probing the full REGAL_MAX_FORWARD window every 15 minutes.
// The near window (today..storedHorizon) is still fully rescanned every run
// — that's what catches 70mm added to dates already on sale — while the far
// edge advances up to `lookahead` days per run. storedHorizon === null (cold
// start / FULL_SCAN) means the true horizon is unknown, so the full
// maxForward is used.
export function computeEffectiveRegalMaxForward(
  today: string,
  storedHorizon: string | null,
  maxForward: number = REGAL_MAX_FORWARD,
  lookahead: number = REGAL_HORIZON_LOOKAHEAD
): number {
  if (storedHorizon === null) return maxForward;
  const daysToHorizon = Math.max(0, daysBetweenYmd(today, storedHorizon));
  return Math.min(maxForward, daysToHorizon + lookahead);
}

// Blocked means the API itself is unreachable, not merely quiet: derive it
// from transport failures only, never from "parsed fine but zero shows",
// so a theatre with a legitimately dark week is never reported BLOCKED (and
// never trips the REGAL_PC offline heartbeat / false outage alert).
export function deriveRegalApiBlocked(datesAttempted: number, datesTransportFail: number): boolean {
  return datesAttempted > 0 && datesTransportFail === datesAttempted;
}

// A deadline-aborted walk must never report a truncated horizon: returning
// null here is what stops scrape.ts from writing a wrong, permanently-capping
// booking horizon back to the DB.
export function resolveRegalObservedHorizon(
  observedHorizon: string | null,
  deadlineExceeded: boolean
): string | null {
  return deadlineExceeded ? null : observedHorizon;
}
