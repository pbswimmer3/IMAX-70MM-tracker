import { describe, it, expect } from "vitest";
import { probeHorizon, type ProbeOptions } from "@/scraper/probe";
import type { RawAmcRecord } from "@/scraper/parseAmc";

// Helper to create a fetchDate function and track which dates were queried
function makeFetchDate(showCounts: Record<string, number>) {
  const queriedDates: string[] = [];

  const fetchDate = async (ymd: string): Promise<RawAmcRecord[]> => {
    queriedDates.push(ymd);
    const count = showCounts[ymd] ?? 0;
    const records: RawAmcRecord[] = [];
    for (let i = 0; i < count; i++) {
      records.push({
        showtimeId: `${ymd}-showtime-${i}`,
        datetimeIso: `${ymd}T20:00:00Z`,
        movieTitle: "X",
        formatLabel: "IMAX 70MM",
      });
    }
    return records;
  };

  return { fetchDate, queriedDates };
}

describe("probeHorizon", () => {
  it("cold start: storedHorizon null, today 2026-07-23, showtimes on 07-23/07-24/07-25 then empty", async () => {
    const { fetchDate, queriedDates } = makeFetchDate({
      "2026-07-23": 2,
      "2026-07-24": 3,
      "2026-07-25": 1,
      "2026-07-26": 0,
      "2026-07-27": 0,
    });

    const opts: ProbeOptions = {
      today: "2026-07-23",
      storedHorizon: null,
      overshoot: 1,
      lookback: 2,
    };

    const result = await probeHorizon(fetchDate, opts);

    expect(result.observedHorizon).toBe("2026-07-25");
    expect(result.datesWithShowtimes).toBe(3);
    expect(queriedDates).toContain("2026-07-23");
    expect(queriedDates).toContain("2026-07-24");
    expect(queriedDates).toContain("2026-07-25");
  });

  it("overshoot stops 1 day past first empty", async () => {
    const { fetchDate, queriedDates } = makeFetchDate({
      "2026-07-23": 2,
      "2026-07-24": 3,
      "2026-07-25": 0,
      "2026-07-26": 0,
    });

    const opts: ProbeOptions = {
      today: "2026-07-23",
      storedHorizon: null,
      overshoot: 1,
      lookback: 2,
    };

    const result = await probeHorizon(fetchDate, opts);

    // Should query 07-25 and 07-26 but NOT 07-27
    expect(queriedDates).toContain("2026-07-25");
    expect(queriedDates).toContain("2026-07-26");
    expect(queriedDates).not.toContain("2026-07-27");
    expect(result.observedHorizon).toBe("2026-07-24");
  });

  it("single-day gap is filled", async () => {
    const { fetchDate, queriedDates } = makeFetchDate({
      "2026-07-23": 2,
      "2026-07-24": 3,
      "2026-07-25": 0,
      "2026-07-26": 2,
      "2026-07-27": 0,
      "2026-07-28": 0,
    });

    const opts: ProbeOptions = {
      today: "2026-07-23",
      storedHorizon: null,
      overshoot: 1,
      lookback: 2,
    };

    const result = await probeHorizon(fetchDate, opts);

    // Empty 07-25 did not end the walk; 07-26 had showtimes
    expect(result.observedHorizon).toBe("2026-07-26");
    expect(result.datesWithShowtimes).toBe(3); // 07-23, 07-24, 07-26
  });

  it("lookback offsets the start", async () => {
    const { fetchDate, queriedDates } = makeFetchDate({
      "2026-07-28": 1,
      "2026-07-29": 1,
      "2026-07-30": 0,
      "2026-07-31": 0,
    });

    const opts: ProbeOptions = {
      today: "2026-07-23",
      storedHorizon: "2026-07-30",
      lookback: 2,
      overshoot: 1,
    };

    const result = await probeHorizon(fetchDate, opts);

    // First queried date should be 2026-07-28 (storedHorizon - lookback)
    expect(queriedDates[0]).toBe("2026-07-28");
  });

  it("start never before today", async () => {
    const { fetchDate, queriedDates } = makeFetchDate({
      "2026-07-23": 1,
      "2026-07-24": 0,
      "2026-07-25": 0,
    });

    const opts: ProbeOptions = {
      today: "2026-07-23",
      storedHorizon: "2026-07-01", // past
      lookback: 2,
      overshoot: 1,
    };

    const result = await probeHorizon(fetchDate, opts);

    // First queried date should be today (2026-07-23)
    expect(queriedDates[0]).toBe("2026-07-23");
  });

  it("maxForward cap", async () => {
    // Every date has showtimes (won't stop due to overshoot)
    const { fetchDate, queriedDates } = makeFetchDate({
      "2026-07-23": 1,
      "2026-07-24": 1,
      "2026-07-25": 1,
      "2026-07-26": 1,
      "2026-07-27": 1,
      "2026-07-28": 1,
      "2026-07-29": 1,
    });

    const opts: ProbeOptions = {
      today: "2026-07-23",
      storedHorizon: null,
      maxForward: 5,
      overshoot: 1,
      lookback: 2,
    };

    const result = await probeHorizon(fetchDate, opts);

    // Should query exactly 5 dates, no infinite loop
    expect(queriedDates).toHaveLength(5);
    expect(queriedDates).toEqual([
      "2026-07-23",
      "2026-07-24",
      "2026-07-25",
      "2026-07-26",
      "2026-07-27",
    ]);
  });
});
