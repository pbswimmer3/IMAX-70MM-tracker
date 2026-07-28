import { describe, it, expect } from "vitest";
import { deriveRegalApiBlocked, resolveRegalObservedHorizon } from "@/scraper/scrape";

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
