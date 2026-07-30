import { describe, it, expect } from "vitest";
import {
  deriveRegalApiBlocked,
  resolveRegalObservedHorizon,
  shouldRotateRegalSession,
  REGAL_MAX_REQUESTS_PER_SESSION,
} from "@/scraper/scrape";

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
