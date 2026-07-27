import { describe, it, expect } from "vitest";
import { shouldFailRun } from "@/scraper/shouldFailRun";

describe("shouldFailRun", () => {
  it("does not fail a dry run, even with every other signal red", () => {
    expect(
      shouldFailRun({
        postFailed: true,
        errors: ["boom"],
        activeMovies: 0,
        theatresPosted: 5,
        theatresMatched: 0,
        showtimesPosted: 313,
        showtimesUpserted: 0,
        dryRun: true,
      })
    ).toBe(false);
  });

  it("fails when the ingest POST itself failed", () => {
    expect(
      shouldFailRun({
        postFailed: true,
        errors: [],
        theatresPosted: 5,
        showtimesPosted: 0,
        dryRun: false,
      })
    ).toBe(true);
  });

  it("fails when the ingest response reported pipeline errors", () => {
    expect(
      shouldFailRun({
        postFailed: false,
        errors: ["unknown theatre (AMC/x); skipping"],
        theatresPosted: 5,
        theatresMatched: 5,
        activeMovies: 1,
        showtimesPosted: 0,
        dryRun: false,
      })
    ).toBe(true);
  });

  it("fails when there are zero active movies to match against", () => {
    expect(
      shouldFailRun({
        postFailed: false,
        errors: [],
        activeMovies: 0,
        theatresPosted: 5,
        theatresMatched: 5,
        showtimesPosted: 0,
        dryRun: false,
      })
    ).toBe(true);
  });

  it("fails when theatres were posted but ingest matched none of them", () => {
    expect(
      shouldFailRun({
        postFailed: false,
        errors: [],
        activeMovies: 1,
        theatresPosted: 5,
        theatresMatched: 0,
        showtimesPosted: 0,
        dryRun: false,
      })
    ).toBe(true);
  });

  it("does not fail on a healthy run", () => {
    expect(
      shouldFailRun({
        postFailed: false,
        errors: [],
        activeMovies: 1,
        theatresPosted: 5,
        theatresMatched: 5,
        showtimesPosted: 0,
        dryRun: false,
      })
    ).toBe(false);
  });

  it("does not fail when no 70mm is playing tonight but movies and theatres resolve fine", () => {
    // Every posted theatre still resolves in the DB (theatresMatched ===
    // theatresPosted) even though none of them had any 70mm showtimes to
    // report — that's a legitimately quiet night, not a broken pipeline.
    expect(
      shouldFailRun({
        postFailed: false,
        errors: [],
        activeMovies: 1,
        theatresPosted: 5,
        theatresMatched: 5,
        showtimesPosted: 0,
        dryRun: false,
      })
    ).toBe(false);
  });

  it("does not fail when activeMovies/theatresMatched are absent (older deployed app version)", () => {
    expect(
      shouldFailRun({
        postFailed: false,
        errors: [],
        theatresPosted: 5,
        showtimesPosted: 0,
        dryRun: false,
      })
    ).toBe(false);
  });

  it("fails when theatres and movies resolved, showtimes were posted, but zero landed", () => {
    // The exact shape from the 2026-07-26 incident: theatresMatched=2,
    // activeMovies=1, 313 70mm showtimes posted, 0 upserted, no errors. That
    // combination can only be a matcher/validation bug.
    expect(
      shouldFailRun({
        postFailed: false,
        errors: [],
        activeMovies: 1,
        theatresPosted: 2,
        theatresMatched: 2,
        showtimesPosted: 313,
        showtimesUpserted: 0,
        dryRun: false,
      })
    ).toBe(true);
  });

  it("does not fail a legitimate no-70mm night (posted=0, upserted=0)", () => {
    expect(
      shouldFailRun({
        postFailed: false,
        errors: [],
        activeMovies: 1,
        theatresPosted: 2,
        theatresMatched: 2,
        showtimesPosted: 0,
        showtimesUpserted: 0,
        dryRun: false,
      })
    ).toBe(false);
  });

  it("does not fail a healthy run where posted showtimes all landed", () => {
    expect(
      shouldFailRun({
        postFailed: false,
        errors: [],
        activeMovies: 1,
        theatresPosted: 2,
        theatresMatched: 2,
        showtimesPosted: 313,
        showtimesUpserted: 313,
        dryRun: false,
      })
    ).toBe(false);
  });

  it("does not fail the posted>0/upserted=0 shape when showtimesUpserted is absent", () => {
    expect(
      shouldFailRun({
        postFailed: false,
        errors: [],
        activeMovies: 1,
        theatresPosted: 2,
        theatresMatched: 2,
        showtimesPosted: 313,
        dryRun: false,
      })
    ).toBe(false);
  });
});
