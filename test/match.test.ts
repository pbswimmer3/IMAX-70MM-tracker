import { describe, it, expect } from "vitest";
import { isInertMatchers, matchesMovie } from "@/lib/match";
import { ODYSSEY_MOVIE } from "@/lib/theatres";
import type { NormalizedShowtime } from "@/lib/adapters/types";

// The exact inert default template the /movies UI shipped before the fix in
// app/movies/AddMovieForm.tsx (kept literal here, not imported, so this test
// still catches the regression even if the form file changes independently).
const INERT_DEFAULT_TEMPLATE = {
  amc: { attributeCodes: ["IMAX70MM", "70MM"], titlePattern: "" },
  regal: { hoCodes: [], titlePattern: "" },
};

describe("isInertMatchers", () => {
  it("is true for the exact inert default template", () => {
    expect(isInertMatchers(INERT_DEFAULT_TEMPLATE)).toBe(true);
  });

  it("is true for an empty object", () => {
    expect(isInertMatchers({})).toBe(true);
  });

  it("is true for missing/undefined/null/non-object input", () => {
    expect(isInertMatchers(undefined)).toBe(true);
    expect(isInertMatchers(null)).toBe(true);
    expect(isInertMatchers("not an object")).toBe(true);
    expect(isInertMatchers(42)).toBe(true);
    expect(isInertMatchers([])).toBe(true);
  });

  it("is false when a chain has a non-empty titlePattern", () => {
    expect(isInertMatchers({ amc: { titlePattern: "odyssey" } })).toBe(false);
    expect(isInertMatchers({ regal: { titlePattern: "odyssey" } })).toBe(false);
  });

  it("is false when amc.movieIds is non-empty", () => {
    expect(isInertMatchers({ amc: { movieIds: ["76238"] } })).toBe(false);
  });

  it("is false when regal.hoCodes is non-empty", () => {
    expect(isInertMatchers({ regal: { hoCodes: ["ho00019076"] } })).toBe(false);
  });

  it("is true when only attributeCodes is present (matchesMovie never reads it)", () => {
    expect(
      isInertMatchers({
        amc: { attributeCodes: ["IMAX70MM", "70MM", "IMAXWITH70MM"] },
      })
    ).toBe(true);
  });
});

describe("matchesMovie", () => {
  const showtime: NormalizedShowtime = {
    externalId: "ext-1",
    startsAt: new Date("2026-08-01T20:00:00Z"),
    movieTitle: "The Odyssey",
    movieExternalId: "76238",
    format: "IMAX 70MM",
    is70mm: true,
  };

  it("matches the real ODYSSEY_MOVIE matchers", () => {
    expect(matchesMovie(showtime, { matchers: ODYSSEY_MOVIE.matchers }, "amc")).toBe(true);
  });

  it("does not match the inert default template", () => {
    expect(matchesMovie(showtime, { matchers: INERT_DEFAULT_TEMPLATE }, "amc")).toBe(false);
  });
});
