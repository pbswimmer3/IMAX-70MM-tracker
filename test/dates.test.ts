import { describe, it, expect } from "vitest";
import { utcDateKey, newDropDates, formatShowtime, formatTheatreDay } from "@/lib/dates";

describe("utcDateKey", () => {
  it("converts UTC date to YYYY-MM-DD format", () => {
    const result = utcDateKey(new Date("2026-07-21T23:30:00Z"));
    expect(result).toBe("2026-07-21");
  });
});

describe("formatShowtime", () => {
  // 2026-08-03T02:00:00Z is 7:00 PM PDT on Aug 2 — the case that used to render
  // as "Mon, Aug 3, 2:00 AM" when the runtime zone was UTC.
  it("renders a UTC instant in Pacific time, not the runtime zone", () => {
    expect(formatShowtime(new Date("2026-08-03T02:00:00Z"))).toBe("Sun, Aug 2, 7:00 PM");
  });

  it("accepts an ISO string", () => {
    expect(formatShowtime("2026-08-03T02:00:00Z")).toBe("Sun, Aug 2, 7:00 PM");
  });

  it("appends the zone name when asked", () => {
    expect(formatShowtime(new Date("2026-08-03T02:00:00Z"), { withZone: true })).toBe(
      "Sun, Aug 2, 7:00 PM PDT"
    );
  });

  it("uses PST for winter showtimes", () => {
    expect(formatShowtime(new Date("2026-01-11T03:00:00Z"), { withZone: true })).toBe(
      "Sat, Jan 10, 7:00 PM PST"
    );
  });
});

describe("formatTheatreDay", () => {
  it("keeps a late-evening Pacific showtime on its own calendar day", () => {
    expect(formatTheatreDay(new Date("2026-08-03T02:00:00Z"))).toBe("Aug 2, 2026");
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
