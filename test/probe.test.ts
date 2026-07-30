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

  it("walk starts at today even when storedHorizon is far in the future", async () => {
    const { fetchDate, queriedDates } = makeFetchDate({
      "2026-07-23": 1,
      "2026-07-24": 1,
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

    // First queried date is always today, not storedHorizon - lookback: the
    // walk rescans the whole window so showtimes added to already-on-sale
    // dates (e.g. 07-23/07-24) are re-discovered, not skipped forever.
    expect(queriedDates[0]).toBe("2026-07-23");
    expect(queriedDates).toContain("2026-07-24");
  });

  it("a gap longer than overshoot BEFORE minEnd does not stop the walk", async () => {
    const { fetchDate, queriedDates } = makeFetchDate({
      "2026-07-23": 1,
      // 07-24..07-27 dark: a 4-day gap, longer than overshoot=1
      "2026-07-28": 2,
      "2026-07-29": 0,
      "2026-07-30": 0,
    });

    const result = await probeHorizon(fetchDate, {
      today: "2026-07-23",
      storedHorizon: "2026-07-28", // minEnd
      overshoot: 1,
    });

    // The walk pushes through the pre-minEnd gap to reach 07-28, then stops
    // 1 day past it per ordinary overshoot semantics.
    expect(queriedDates).toContain("2026-07-28");
    expect(result.observedHorizon).toBe("2026-07-28");
    expect(queriedDates).not.toContain("2026-07-31");
  });

  it("the same gap AFTER minEnd does stop the walk", async () => {
    const { fetchDate, queriedDates } = makeFetchDate({
      "2026-07-23": 1,
      "2026-07-24": 2,
      // 07-25..07-28 dark: a 4-day gap, entirely after minEnd
      "2026-07-29": 3,
    });

    const result = await probeHorizon(fetchDate, {
      today: "2026-07-23",
      storedHorizon: "2026-07-24", // minEnd
      overshoot: 1,
    });

    // Ordinary overshoot=1 termination applies once past minEnd: the walk
    // stops 1 empty day past 07-24 and never reaches the later 07-29 data.
    expect(result.observedHorizon).toBe("2026-07-24");
    expect(queriedDates).not.toContain("2026-07-29");
  });

  it("minEnd null (FULL_SCAN) behaves like a plain walk from today", async () => {
    const { fetchDate, queriedDates } = makeFetchDate({
      "2026-07-23": 1,
      "2026-07-24": 0,
      "2026-07-25": 0,
    });

    const result = await probeHorizon(fetchDate, {
      today: "2026-07-23",
      storedHorizon: null,
      overshoot: 1,
    });

    expect(queriedDates[0]).toBe("2026-07-23");
    expect(result.observedHorizon).toBe("2026-07-23");
    expect(queriedDates).not.toContain("2026-07-26");
  });

  it("a date already probed is not double-counted in records", async () => {
    // Simulates rescanning from today across two consecutive runs: the same
    // date is probed again but showtimes for it should not be duplicated
    // within a single walk's result set (dedup happens per-run, not across
    // runs — this asserts probeHorizon itself never queries a date twice in
    // one walk).
    const { fetchDate, queriedDates } = makeFetchDate({
      "2026-07-23": 2,
      "2026-07-24": 0,
      "2026-07-25": 0,
    });

    const result = await probeHorizon(fetchDate, {
      today: "2026-07-23",
      storedHorizon: "2026-07-23",
      overshoot: 1,
    });

    const occurrences = queriedDates.filter((d) => d === "2026-07-23").length;
    expect(occurrences).toBe(1);
    expect(result.records).toHaveLength(2);
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

  it("tags each record with the probed date (default queryDate tag)", async () => {
    const { fetchDate } = makeFetchDate({ "2026-07-23": 2, "2026-07-24": 0, "2026-07-25": 0 });
    const result = await probeHorizon(fetchDate, {
      today: "2026-07-23",
      storedHorizon: null,
      overshoot: 1,
      lookback: 2,
    });
    expect(result.records).toHaveLength(2);
    expect(result.records.every((r) => r.queryDate === "2026-07-23")).toBe(true);
  });

  it("custom tag replaces the default queryDate stamping", async () => {
    // Regal records arrive already normalized with showDate set, so scrapeRegal
    // passes a no-op tag rather than letting AMC's queryDate be written onto them.
    const { fetchDate } = makeFetchDate({ "2026-07-23": 1, "2026-07-24": 0, "2026-07-25": 0 });
    const result = await probeHorizon(fetchDate, {
      today: "2026-07-23",
      storedHorizon: null,
      overshoot: 1,
      lookback: 2,
      tag: () => {},
    });
    expect(result.records[0].queryDate).toBeUndefined();
  });

  it("Regal overshoot=3 walks past a multi-day gap to the real horizon", async () => {
    // The reported bug: the horizon looked like 08-10 when tickets were on sale
    // through 08-19. With a 2-day dark stretch mid-window, overshoot=1 would
    // stop at 08-11; overshoot=3 reaches 08-19.
    const counts: Record<string, number> = {};
    for (const d of ["08-08", "08-09", "08-10"]) counts[`2026-${d}`] = 3;
    // 08-11 / 08-12 dark
    for (const d of ["08-13", "08-14", "08-18", "08-19"]) counts[`2026-${d}`] = 2;
    const { fetchDate, queriedDates } = makeFetchDate(counts);

    const result = await probeHorizon(fetchDate, {
      today: "2026-08-08",
      storedHorizon: null,
      overshoot: 3,
      lookback: 2,
    });

    expect(result.observedHorizon).toBe("2026-08-19");
    expect(queriedDates).toContain("2026-08-19");
    // Stops 3 empty days past the last real date rather than running to maxForward.
    expect(queriedDates).not.toContain("2026-08-24");
  });

  it("a 14-day fixed window would have missed the real horizon (regression guard)", async () => {
    // Direct analogue of the shipped bug: showtimes on sale today+21, scraper
    // only ever asked about today..today+13.
    const counts: Record<string, number> = {};
    for (let i = 0; i <= 21; i++) {
      const d = new Date(Date.UTC(2026, 6, 29));
      d.setUTCDate(d.getUTCDate() + i);
      counts[d.toISOString().slice(0, 10)] = 2;
    }
    const { fetchDate } = makeFetchDate(counts);

    const result = await probeHorizon(fetchDate, {
      today: "2026-07-29",
      storedHorizon: null,
      overshoot: 3,
      lookback: 2,
    });

    expect(result.observedHorizon).toBe("2026-08-19");
    expect(result.datesWithShowtimes).toBe(22);
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

  it("deadline abort stops the walk early and reports deadlineExceeded with observedHorizon left unset for later dates", async () => {
    // Every date has showtimes, so nothing but the deadline would stop this
    // walk — simulates a hung/slow sequential run that must bail out rather
    // than run forever or silently truncate the horizon.
    const { fetchDate, queriedDates } = makeFetchDate({
      "2026-07-23": 1,
      "2026-07-24": 1,
      "2026-07-25": 1,
      "2026-07-26": 1,
      "2026-07-27": 1,
    });

    // Fake clock: advances by 1000ms per fetchDate call so the 3rd call
    // crosses a 2500ms deadline.
    let fakeNow = 0;
    const now = () => fakeNow;
    const timedFetchDate = async (ymd: string) => {
      fakeNow += 1000;
      return fetchDate(ymd);
    };

    const result = await probeHorizon(timedFetchDate, {
      today: "2026-07-23",
      storedHorizon: null,
      overshoot: 1,
      lookback: 2,
      maxForward: 20,
      deadlineMs: 2500,
      now,
    });

    expect(result.deadlineExceeded).toBe(true);
    // Stopped well short of maxForward / the "every date has showtimes" tail.
    expect(queriedDates.length).toBeLessThan(5);
  });

  it("no deadline configured never sets deadlineExceeded", async () => {
    const { fetchDate } = makeFetchDate({
      "2026-07-23": 1,
      "2026-07-24": 0,
      "2026-07-25": 0,
    });
    const result = await probeHorizon(fetchDate, {
      today: "2026-07-23",
      storedHorizon: null,
      overshoot: 1,
      lookback: 2,
    });
    expect(result.deadlineExceeded).toBe(false);
  });
});

describe("probeHorizon maxForwardReached", () => {
  // The walk stopping because it ran out of iterations is NOT the same as
  // finding the end of the booking window, but both used to produce an
  // identical-looking observedHorizon. Measured 2026-07-29: maxForward 60 cut
  // two Regal theatres off at today+59 while Regal was still selling tickets,
  // and the run reported that cut-off as the horizon.
  it("sets maxForwardReached when every probed date still has showtimes", async () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 10; i++) {
      const d = new Date(Date.UTC(2026, 6, 23));
      d.setUTCDate(d.getUTCDate() + i);
      counts[d.toISOString().slice(0, 10)] = 3;
    }
    const { fetchDate, queriedDates } = makeFetchDate(counts);
    const res = await probeHorizon(fetchDate, {
      today: "2026-07-23",
      storedHorizon: null,
      maxForward: 5,
    });

    expect(queriedDates).toHaveLength(5);
    expect(res.maxForwardReached).toBe(true);
    // The horizon is only a lower bound here — the window demonstrably continues.
    expect(res.observedHorizon).toBe("2026-07-27");
  });

  it("does not set maxForwardReached when the walk ends via overshoot", async () => {
    const { fetchDate } = makeFetchDate({
      "2026-07-23": 2,
      "2026-07-24": 2,
    });
    const res = await probeHorizon(fetchDate, {
      today: "2026-07-23",
      storedHorizon: null,
      overshoot: 1,
      maxForward: 30,
    });

    expect(res.maxForwardReached).toBe(false);
    expect(res.observedHorizon).toBe("2026-07-24");
  });

  it("does not set maxForwardReached when the deadline aborts the walk", async () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 40; i++) {
      const d = new Date(Date.UTC(2026, 6, 23));
      d.setUTCDate(d.getUTCDate() + i);
      counts[d.toISOString().slice(0, 10)] = 3;
    }
    let clock = 0;
    const { fetchDate } = makeFetchDate(counts);
    const res = await probeHorizon(fetchDate, {
      today: "2026-07-23",
      storedHorizon: null,
      maxForward: 30,
      deadlineMs: 50,
      now: () => (clock += 20),
    });

    expect(res.deadlineExceeded).toBe(true);
    expect(res.maxForwardReached).toBe(false);
  });
});
