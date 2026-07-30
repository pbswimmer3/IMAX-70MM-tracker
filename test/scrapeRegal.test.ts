import { describe, it, expect } from "vitest";
import {
  deriveRegalApiBlocked,
  resolveRegalObservedHorizon,
  shouldRotateRegalSession,
  isFatalRegalTransportError,
  isRegalRunBudgetExhausted,
  computeEffectiveRegalMaxForward,
  REGAL_MAX_REQUESTS_PER_SESSION,
  REGAL_MAX_FORWARD,
  REGAL_HORIZON_LOOKAHEAD,
  REGAL_RUN_DEADLINE_MS,
} from "@/scraper/regalPolicy";

// Pure helpers pulled out of scrapeRegal() so the transport-vs-empty
// classification (Problem C.4) and the deadline-abort contract (Problem A.3)
// are unit-testable without a real Playwright page.

describe("deriveRegalApiBlocked", () => {
  it("is blocked when every attempted date failed at the transport layer", () => {
    expect(deriveRegalApiBlocked(5, 5)).toBe(true);
  });

  it("is NOT blocked when at least one date parsed as JSON, even with zero showtimes (legitimately dark night)", () => {
    // 5 attempted, only 1 transport failure — 4 dates returned valid (if
    // empty) JSON, so this must never read as an outage.
    expect(deriveRegalApiBlocked(5, 1)).toBe(false);
  });

  it("is NOT blocked when nothing was attempted", () => {
    expect(deriveRegalApiBlocked(0, 0)).toBe(false);
  });

  it("is blocked when the single attempted date failed at the transport layer", () => {
    expect(deriveRegalApiBlocked(1, 1)).toBe(true);
  });
});

describe("shouldRotateRegalSession", () => {
  // Regal's ~25-request-per-session quota (measured live): request 26+ on
  // the same session hangs forever. REGAL_MAX_REQUESTS_PER_SESSION=20 is a
  // safety margin under that cliff — rotation must trigger BEFORE the
  // request that would hit the wall, not after.
  it("does not rotate while under the max", () => {
    expect(shouldRotateRegalSession(0, 20)).toBe(false);
    expect(shouldRotateRegalSession(19, 20)).toBe(false);
  });

  it("rotates once the counter reaches the max", () => {
    expect(shouldRotateRegalSession(20, 20)).toBe(true);
  });

  it("keeps rotating if the counter is somehow past the max", () => {
    expect(shouldRotateRegalSession(25, 20)).toBe(true);
  });

  it("the configured production max is 20, a margin under the measured ~25 quota", () => {
    expect(REGAL_MAX_REQUESTS_PER_SESSION).toBe(20);
  });
});

describe("resolveRegalObservedHorizon", () => {
  it("returns null when the walk hit its deadline, regardless of what was observed", () => {
    expect(resolveRegalObservedHorizon("2026-08-19", true)).toBeNull();
  });

  it("passes the observed horizon through when the deadline was not hit", () => {
    expect(resolveRegalObservedHorizon("2026-08-19", false)).toBe("2026-08-19");
  });

  it("passes null through when nothing was observed and no deadline was hit", () => {
    expect(resolveRegalObservedHorizon(null, false)).toBeNull();
  });
});

// Classifies a whole-browser/session death (which a fresh context on the same
// crashed browser cannot recover from) apart from an ordinary per-date
// timeout, which just means try the next date normally.
describe("isFatalRegalTransportError", () => {
  it.each([
    "Target crashed",
    "page.evaluate: Target crashed ",
    "page.evaluate: Target page, context or browser has been closed",
    "Target closed",
    "browser has been closed",
    "Protocol error (Page.navigate): Session closed",
  ])("treats %j as fatal", (reason) => {
    expect(isFatalRegalTransportError(reason)).toBe(true);
  });

  it.each([
    "page.evaluate timed out (8000ms)",
    "http 500",
    "non-json content-type",
    "invalid json body",
    "in-page fetch failed",
    "",
  ])("treats %j as an ordinary (non-fatal) transport failure", (reason) => {
    expect(isFatalRegalTransportError(reason)).toBe(false);
  });
});

describe("isRegalRunBudgetExhausted", () => {
  it("is not exhausted while under the deadline", () => {
    expect(isRegalRunBudgetExhausted(0, 1000)).toBe(false);
    expect(isRegalRunBudgetExhausted(999, 1000)).toBe(false);
  });

  it("is exhausted once elapsed reaches the deadline", () => {
    expect(isRegalRunBudgetExhausted(1000, 1000)).toBe(true);
    expect(isRegalRunBudgetExhausted(1500, 1000)).toBe(true);
  });

  it("defaults to the production REGAL_RUN_DEADLINE_MS (10 min)", () => {
    expect(REGAL_RUN_DEADLINE_MS).toBe(10 * 60 * 1000);
    expect(isRegalRunBudgetExhausted(REGAL_RUN_DEADLINE_MS - 1)).toBe(false);
    expect(isRegalRunBudgetExhausted(REGAL_RUN_DEADLINE_MS)).toBe(true);
  });
});

describe("computeEffectiveRegalMaxForward", () => {
  it("uses the full REGAL_MAX_FORWARD on cold start (storedHorizon null)", () => {
    expect(computeEffectiveRegalMaxForward("2026-07-29", null)).toBe(REGAL_MAX_FORWARD);
  });

  it("bounds to storedHorizon distance + lookahead when that's under the cap", () => {
    // storedHorizon is 10 days out; effective = 10 + 7 = 17.
    expect(computeEffectiveRegalMaxForward("2026-07-29", "2026-08-08", 120, 7)).toBe(17);
  });

  it("never exceeds REGAL_MAX_FORWARD even with a far-future storedHorizon", () => {
    expect(computeEffectiveRegalMaxForward("2026-07-29", "2027-01-01", 120, 7)).toBe(120);
  });

  it("floors at lookahead when storedHorizon is in the past (never negative)", () => {
    expect(computeEffectiveRegalMaxForward("2026-07-29", "2026-07-01", 120, 7)).toBe(7);
  });

  it("the production default lookahead is 7 days", () => {
    expect(REGAL_HORIZON_LOOKAHEAD).toBe(7);
  });
});
