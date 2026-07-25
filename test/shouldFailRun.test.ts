import { describe, it, expect } from "vitest";
import { shouldFailRun } from "@/scraper/shouldFailRun";

describe("shouldFailRun", () => {
  it("does not fail a dry run even with 0 upserted", () => {
    expect(shouldFailRun({ posted70mm: 10, showtimesUpserted: 0, errors: [], dryRun: true })).toBe(
      false
    );
  });

  it("does not fail when there were legitimately 0 scraped 70mm showtimes", () => {
    expect(
      shouldFailRun({ posted70mm: 0, showtimesUpserted: 0, errors: [], dryRun: false })
    ).toBe(false);
  });

  it("fails when 70mm showtimes were posted but nothing was upserted", () => {
    expect(
      shouldFailRun({ posted70mm: 10, showtimesUpserted: 0, errors: [], dryRun: false })
    ).toBe(true);
  });

  it("fails when the ingest response reported errors, even if some rows upserted", () => {
    expect(
      shouldFailRun({
        posted70mm: 10,
        showtimesUpserted: 5,
        errors: ["unknown theatre (AMC/x); skipping"],
        dryRun: false,
      })
    ).toBe(true);
  });

  it("does not fail on a healthy run", () => {
    expect(
      shouldFailRun({ posted70mm: 10, showtimesUpserted: 10, errors: [], dryRun: false })
    ).toBe(false);
  });
});
