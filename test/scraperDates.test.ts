import { describe, it, expect } from "vitest";
import { ymdInZone, todayYmd, addDaysYmd, THEATRE_TIME_ZONE } from "@/scraper/theatres";

describe("ymdInZone", () => {
  it("returns the theatre-local day, not the UTC day, after 5 PM PT", () => {
    // 2026-07-30T02:30:00Z is 7:30 PM PDT on 2026-07-29. Deriving the probe's
    // start date from the UTC day would skip that evening's showings entirely
    // on every Regal run after 5 PM local.
    const instant = new Date("2026-07-30T02:30:00Z");
    expect(instant.toISOString().slice(0, 10)).toBe("2026-07-30");
    expect(ymdInZone(instant, THEATRE_TIME_ZONE)).toBe("2026-07-29");
  });

  it("agrees with UTC during PT daytime", () => {
    expect(ymdInZone(new Date("2026-07-29T18:00:00Z"), THEATRE_TIME_ZONE)).toBe("2026-07-29");
  });

  it("handles PST (winter offset) as well as PDT", () => {
    // 2026-01-15T03:00:00Z is 7:00 PM PST on 2026-01-14.
    expect(ymdInZone(new Date("2026-01-15T03:00:00Z"), THEATRE_TIME_ZONE)).toBe("2026-01-14");
  });

  it("zero-pads month and day", () => {
    expect(ymdInZone(new Date("2026-03-05T20:00:00Z"), THEATRE_TIME_ZONE)).toBe("2026-03-05");
  });
});

describe("todayYmd", () => {
  it("is a well-formed YYYY-MM-DD within a day of the UTC date", () => {
    const today = todayYmd();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const utcToday = new Date().toISOString().slice(0, 10);
    expect([utcToday, addDaysYmd(utcToday, -1)]).toContain(today);
  });
});

describe("addDaysYmd", () => {
  it("crosses month and year boundaries", () => {
    expect(addDaysYmd("2026-08-19", 1)).toBe("2026-08-20");
    expect(addDaysYmd("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDaysYmd("2026-08-01", -2)).toBe("2026-07-30");
    expect(addDaysYmd("2026-12-31", 1)).toBe("2027-01-01");
  });
});
