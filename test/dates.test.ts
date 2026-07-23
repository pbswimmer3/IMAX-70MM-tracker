import { describe, it, expect } from "vitest";
import { utcDateKey, newDropDates } from "@/lib/dates";

describe("utcDateKey", () => {
  it("converts UTC date to YYYY-MM-DD format", () => {
    const result = utcDateKey(new Date("2026-07-21T23:30:00Z"));
    expect(result).toBe("2026-07-21");
  });
});

describe("newDropDates", () => {
  it("returns new dates, deduped and sorted", () => {
    const existing = new Set(["2026-07-21"]);
    const incoming = ["2026-07-21", "2026-07-22", "2026-07-22", "2026-07-23"];
    const result = newDropDates(existing, incoming);
    expect(result).toEqual(["2026-07-22", "2026-07-23"]);
  });
});
