import { describe, it, expect } from "vitest";
import { parseRegalJson, parseRegalJsonWithStats } from "@/scraper/parseRegal";

describe("parseRegalJson", () => {
  describe("basic parsing", () => {
    it("parses a performance with IMAX 70mm correctly", () => {
      const payload = {
        showDate: "2026-07-28T00:00:00",
        shows: [
          {
            TheatreCode: "1484",
            AdvertiseShowDate: "2026-07-28T00:00:00",
            UtcDate: "2026-07-28T07:00:00.000Z",
            Film: [
              {
                Title: "The Odyssey",
                MasterMovieCode: "HO00019072",
                Performances: [
                  {
                    Auditorium: 1,
                    PerformanceId: 105268,
                    PerformanceAttributes: ["IMAX 70mm", "No Passes", "Recliner", "2D"],
                    PerformanceGroup: "",
                    CalendarShowTime: "2026-07-28T07:00:00",
                    UtcShowTime: "2026-07-28T14:00:00.000Z",
                    UnixTime: 1785222000000,
                    StopSales: false,
                  },
                ],
              },
            ],
          },
        ],
        movies: [],
        attributes: [],
        futureShows: [],
        datesWithShows: [],
      };

      const result = parseRegalJson([payload]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        externalId: "105268",
        startsAt: "2026-07-28T14:00:00.000Z",
        movieTitle: "The Odyssey",
        movieExternalId: "HO00019072",
        format: "IMAX 70mm",
        is70mm: true,
        showDate: "2026-07-28",
      });
    });
  });

  describe("attribute filtering", () => {
    // FIX 4: non-70mm performances are now RETURNED (is70mm: false) instead of
    // dropped, so scrape.ts can tell "0 real 70mm" apart from "parser broke".
    it("returns performances with only non-70mm attributes, flagged is70mm: false", () => {
      const payload = {
        showDate: "2026-07-28T00:00:00",
        shows: [
          {
            TheatreCode: "1484",
            AdvertiseShowDate: "2026-07-28T00:00:00",
            UtcDate: "2026-07-28T07:00:00.000Z",
            Film: [
              {
                Title: "Some Movie",
                MasterMovieCode: "ABC123",
                Performances: [
                  {
                    PerformanceId: 999,
                    PerformanceAttributes: ["2D", "Laser", "4DX"],
                    UtcShowTime: "2026-07-28T14:00:00.000Z",
                    UnixTime: 1785222000000,
                  },
                ],
              },
            ],
          },
        ],
        movies: [],
        attributes: [],
        futureShows: [],
        datesWithShows: [],
      };

      const result = parseRegalJson([payload]);
      expect(result).toHaveLength(1);
      expect(result[0].is70mm).toBe(false);
      expect(result[0].format).toBe("Standard");
    });

    it("uses PerformanceGroup as format when non-70mm and non-empty", () => {
      const payload = {
        showDate: "2026-07-28T00:00:00",
        shows: [
          {
            TheatreCode: "1484",
            AdvertiseShowDate: "2026-07-28T00:00:00",
            UtcDate: "2026-07-28T07:00:00.000Z",
            Film: [
              {
                Title: "Some Movie",
                MasterMovieCode: "ABC123",
                Performances: [
                  {
                    PerformanceId: 1000,
                    PerformanceAttributes: ["2D"],
                    PerformanceGroup: "Standard Digital",
                    UtcShowTime: "2026-07-28T14:00:00.000Z",
                    UnixTime: 1785222000000,
                  },
                ],
              },
            ],
          },
        ],
        movies: [],
        attributes: [],
        futureShows: [],
        datesWithShows: [],
      };

      const result = parseRegalJson([payload]);
      expect(result).toHaveLength(1);
      expect(result[0].is70mm).toBe(false);
      expect(result[0].format).toBe("Standard Digital");
    });

    it("includes performances with bare 70mm attribute", () => {
      const payload = {
        showDate: "2026-07-28T00:00:00",
        shows: [
          {
            TheatreCode: "1484",
            AdvertiseShowDate: "2026-07-28T00:00:00",
            UtcDate: "2026-07-28T07:00:00.000Z",
            Film: [
              {
                Title: "Film A",
                MasterMovieCode: "FILM_A",
                Performances: [
                  {
                    PerformanceId: 111,
                    PerformanceAttributes: ["70mm", "2D"],
                    UtcShowTime: "2026-07-28T14:00:00.000Z",
                    UnixTime: 1785222000000,
                  },
                ],
              },
            ],
          },
        ],
        movies: [],
        attributes: [],
        futureShows: [],
        datesWithShows: [],
      };

      const result = parseRegalJson([payload]);
      expect(result).toHaveLength(1);
      expect(result[0].format).toBe("70mm");
    });

    it("prefers IMAX 70mm when both 70mm and IMAX 70mm are present", () => {
      const payload = {
        showDate: "2026-07-28T00:00:00",
        shows: [
          {
            TheatreCode: "1484",
            AdvertiseShowDate: "2026-07-28T00:00:00",
            UtcDate: "2026-07-28T07:00:00.000Z",
            Film: [
              {
                Title: "Film B",
                MasterMovieCode: "FILM_B",
                Performances: [
                  {
                    PerformanceId: 222,
                    PerformanceAttributes: ["70mm", "IMAX 70mm", "2D"],
                    UtcShowTime: "2026-07-28T14:00:00.000Z",
                    UnixTime: 1785222000000,
                  },
                ],
              },
            ],
          },
        ],
        movies: [],
        attributes: [],
        futureShows: [],
        datesWithShows: [],
      };

      const result = parseRegalJson([payload]);
      expect(result).toHaveLength(1);
      expect(result[0].format).toBe("IMAX 70mm");
    });
  });

  describe("showDate handling", () => {
    it("extracts showDate as YYYY-MM-DD from AdvertiseShowDate without timezone shifting", () => {
      const payload = {
        showDate: "2026-07-27T00:00:00",
        shows: [
          {
            TheatreCode: "1484",
            AdvertiseShowDate: "2026-07-28T00:00:00",
            UtcDate: "2026-07-28T07:00:00.000Z",
            Film: [
              {
                Title: "Test Movie",
                MasterMovieCode: "TEST123",
                Performances: [
                  {
                    PerformanceId: 333,
                    PerformanceAttributes: ["IMAX 70mm"],
                    UtcShowTime: "2026-07-28T14:00:00.000Z",
                    UnixTime: 1785222000000,
                  },
                ],
              },
            ],
          },
        ],
        movies: [],
        attributes: [],
        futureShows: [],
        datesWithShows: [],
      };

      const result = parseRegalJson([payload]);
      expect(result).toHaveLength(1);
      expect(result[0].showDate).toBe("2026-07-28");
    });

    it("falls back to payload.showDate when show.AdvertiseShowDate is missing", () => {
      const payload = {
        showDate: "2026-07-28T00:00:00",
        shows: [
          {
            TheatreCode: "1484",
            UtcDate: "2026-07-28T07:00:00.000Z",
            Film: [
              {
                Title: "Test Movie",
                MasterMovieCode: "TEST123",
                Performances: [
                  {
                    PerformanceId: 444,
                    PerformanceAttributes: ["IMAX 70mm"],
                    UtcShowTime: "2026-07-28T14:00:00.000Z",
                    UnixTime: 1785222000000,
                  },
                ],
              },
            ],
          },
        ],
        movies: [],
        attributes: [],
        futureShows: [],
        datesWithShows: [],
      };

      const result = parseRegalJson([payload]);
      expect(result).toHaveLength(1);
      expect(result[0].showDate).toBe("2026-07-28");
    });
  });

  describe("deduplication", () => {
    it("returns one result for duplicate PerformanceIds across payloads", () => {
      const payload1 = {
        showDate: "2026-07-28T00:00:00",
        shows: [
          {
            TheatreCode: "1484",
            AdvertiseShowDate: "2026-07-28T00:00:00",
            UtcDate: "2026-07-28T07:00:00.000Z",
            Film: [
              {
                Title: "Film X",
                MasterMovieCode: "FILM_X",
                Performances: [
                  {
                    PerformanceId: 555,
                    PerformanceAttributes: ["IMAX 70mm"],
                    UtcShowTime: "2026-07-28T14:00:00.000Z",
                    UnixTime: 1785222000000,
                  },
                ],
              },
            ],
          },
        ],
        movies: [],
        attributes: [],
        futureShows: [],
        datesWithShows: [],
      };

      const payload2 = {
        showDate: "2026-07-29T00:00:00",
        shows: [
          {
            TheatreCode: "1484",
            AdvertiseShowDate: "2026-07-29T00:00:00",
            UtcDate: "2026-07-29T07:00:00.000Z",
            Film: [
              {
                Title: "Film X",
                MasterMovieCode: "FILM_X",
                Performances: [
                  {
                    PerformanceId: 555,
                    PerformanceAttributes: ["IMAX 70mm"],
                    UtcShowTime: "2026-07-29T14:00:00.000Z",
                    UnixTime: 1785308400000,
                  },
                ],
              },
            ],
          },
        ],
        movies: [],
        attributes: [],
        futureShows: [],
        datesWithShows: [],
      };

      const result = parseRegalJson([payload1, payload2]);
      expect(result).toHaveLength(1);
      expect(result[0].externalId).toBe("555");
    });
  });

  describe("malformed input handling", () => {
    it("returns empty array for empty input", () => {
      expect(parseRegalJson([])).toEqual([]);
    });

    it("returns empty array for null values in input", () => {
      expect(parseRegalJson([null])).toEqual([]);
    });

    it("returns empty array for empty objects", () => {
      expect(parseRegalJson([{}])).toEqual([]);
    });

    it("returns empty array when shows is missing", () => {
      const payload = {
        showDate: "2026-07-28T00:00:00",
        movies: [],
        attributes: [],
        futureShows: [],
        datesWithShows: [],
      };
      expect(parseRegalJson([payload])).toEqual([]);
    });

    it("returns empty array when Performances is missing from Film", () => {
      const payload = {
        showDate: "2026-07-28T00:00:00",
        shows: [
          {
            TheatreCode: "1484",
            AdvertiseShowDate: "2026-07-28T00:00:00",
            UtcDate: "2026-07-28T07:00:00.000Z",
            Film: [
              {
                Title: "Test Movie",
                MasterMovieCode: "TEST123",
              },
            ],
          },
        ],
        movies: [],
        attributes: [],
        futureShows: [],
        datesWithShows: [],
      };
      expect(parseRegalJson([payload])).toEqual([]);
    });
  });

  describe("timestamp handling", () => {
    it("falls back to UnixTime when UtcShowTime is missing", () => {
      const payload = {
        showDate: "2026-07-28T00:00:00",
        shows: [
          {
            TheatreCode: "1484",
            AdvertiseShowDate: "2026-07-28T00:00:00",
            UtcDate: "2026-07-28T07:00:00.000Z",
            Film: [
              {
                Title: "Test Movie",
                MasterMovieCode: "TEST123",
                Performances: [
                  {
                    PerformanceId: 666,
                    PerformanceAttributes: ["IMAX 70mm"],
                    UnixTime: 1785247200000,
                  },
                ],
              },
            ],
          },
        ],
        movies: [],
        attributes: [],
        futureShows: [],
        datesWithShows: [],
      };

      const result = parseRegalJson([payload]);
      expect(result).toHaveLength(1);
      expect(result[0].startsAt).toBe("2026-07-28T14:00:00.000Z");
    });

    it("skips performance when both UtcShowTime and UnixTime are missing", () => {
      const payload = {
        showDate: "2026-07-28T00:00:00",
        shows: [
          {
            TheatreCode: "1484",
            AdvertiseShowDate: "2026-07-28T00:00:00",
            UtcDate: "2026-07-28T07:00:00.000Z",
            Film: [
              {
                Title: "Test Movie",
                MasterMovieCode: "TEST123",
                Performances: [
                  {
                    PerformanceId: 777,
                    PerformanceAttributes: ["IMAX 70mm"],
                    CalendarShowTime: "2026-07-28T07:00:00",
                  },
                ],
              },
            ],
          },
        ],
        movies: [],
        attributes: [],
        futureShows: [],
        datesWithShows: [],
      };

      const result = parseRegalJson([payload]);
      expect(result).toHaveLength(0);
    });

    it("prefers UtcShowTime over UnixTime when both are present", () => {
      const payload = {
        showDate: "2026-07-28T00:00:00",
        shows: [
          {
            TheatreCode: "1484",
            AdvertiseShowDate: "2026-07-28T00:00:00",
            UtcDate: "2026-07-28T07:00:00.000Z",
            Film: [
              {
                Title: "Test Movie",
                MasterMovieCode: "TEST123",
                Performances: [
                  {
                    PerformanceId: 888,
                    PerformanceAttributes: ["IMAX 70mm"],
                    UtcShowTime: "2026-07-28T15:00:00.000Z",
                    UnixTime: 1785222000000,
                  },
                ],
              },
            ],
          },
        ],
        movies: [],
        attributes: [],
        futureShows: [],
        datesWithShows: [],
      };

      const result = parseRegalJson([payload]);
      expect(result).toHaveLength(1);
      expect(result[0].startsAt).toBe("2026-07-28T15:00:00.000Z");
    });

    // FIX 1: a zoneless UtcShowTime must be treated as UTC, not host-local —
    // otherwise it silently shifts by the scraper machine's UTC offset.
    it("treats a zoneless UtcShowTime as UTC", () => {
      const payload = {
        showDate: "2026-07-28T00:00:00",
        shows: [
          {
            TheatreCode: "1484",
            AdvertiseShowDate: "2026-07-28T00:00:00",
            UtcDate: "2026-07-28T07:00:00.000Z",
            Film: [
              {
                Title: "Test Movie",
                MasterMovieCode: "TEST123",
                Performances: [
                  {
                    PerformanceId: 1100,
                    PerformanceAttributes: ["IMAX 70mm"],
                    UtcShowTime: "2026-07-28T14:00:00",
                  },
                ],
              },
            ],
          },
        ],
        movies: [],
        attributes: [],
        futureShows: [],
        datesWithShows: [],
      };

      const result = parseRegalJson([payload]);
      expect(result).toHaveLength(1);
      expect(result[0].startsAt).toBe("2026-07-28T14:00:00.000Z");
    });

    // FIX 2: UnixTime is documented as ms, but a seconds-valued payload should
    // still resolve to the correct instant instead of a bogus 1970s date.
    it("normalizes a seconds-valued UnixTime to the same instant as ms", () => {
      const payload = {
        showDate: "2026-07-28T00:00:00",
        shows: [
          {
            TheatreCode: "1484",
            AdvertiseShowDate: "2026-07-28T00:00:00",
            UtcDate: "2026-07-28T07:00:00.000Z",
            Film: [
              {
                Title: "Test Movie",
                MasterMovieCode: "TEST123",
                Performances: [
                  {
                    PerformanceId: 1200,
                    PerformanceAttributes: ["IMAX 70mm"],
                    UnixTime: 1785247200, // seconds, not ms
                  },
                ],
              },
            ],
          },
        ],
        movies: [],
        attributes: [],
        futureShows: [],
        datesWithShows: [],
      };

      const result = parseRegalJson([payload]);
      expect(result).toHaveLength(1);
      expect(result[0].startsAt).toBe("2026-07-28T14:00:00.000Z");
    });
  });

  describe("theatre filtering (FIX 3)", () => {
    const makePayload = (theatreCode: string, performanceId: number) => ({
      showDate: "2026-07-28T00:00:00",
      shows: [
        {
          TheatreCode: theatreCode,
          AdvertiseShowDate: "2026-07-28T00:00:00",
          UtcDate: "2026-07-28T07:00:00.000Z",
          Film: [
            {
              Title: "Test Movie",
              MasterMovieCode: "TEST123",
              Performances: [
                {
                  PerformanceId: performanceId,
                  PerformanceAttributes: ["IMAX 70mm"],
                  UtcShowTime: "2026-07-28T14:00:00.000Z",
                },
              ],
            },
          ],
        },
      ],
      movies: [],
      attributes: [],
      futureShows: [],
      datesWithShows: [],
    });

    it("excludes a shows[] entry whose TheatreCode does not match expectedTheatreCode", () => {
      const payload = makePayload("9999", 1300);
      const result = parseRegalJson([payload], "1484");
      expect(result).toHaveLength(0);
    });

    it("includes a shows[] entry whose TheatreCode matches expectedTheatreCode", () => {
      const payload = makePayload("1484", 1301);
      const result = parseRegalJson([payload], "1484");
      expect(result).toHaveLength(1);
    });

    it("includes non-matching TheatreCode entries when expectedTheatreCode is omitted", () => {
      const payload = makePayload("9999", 1302);
      const result = parseRegalJson([payload]);
      expect(result).toHaveLength(1);
    });
  });

  describe("parseRegalJsonWithStats", () => {
    it("counts kept/noTime/noId/dupSameStart/dupDifferentStart correctly", () => {
      const payload1 = {
        showDate: "2026-07-28T00:00:00",
        shows: [
          {
            TheatreCode: "1484",
            AdvertiseShowDate: "2026-07-28T00:00:00",
            UtcDate: "2026-07-28T07:00:00.000Z",
            Film: [
              {
                Title: "Test Movie",
                MasterMovieCode: "TEST123",
                Performances: [
                  // kept
                  {
                    PerformanceId: 2000,
                    PerformanceAttributes: ["IMAX 70mm"],
                    UtcShowTime: "2026-07-28T14:00:00.000Z",
                  },
                  // noTime: no UtcShowTime, no UnixTime
                  {
                    PerformanceId: 2001,
                    PerformanceAttributes: ["2D"],
                  },
                  // noId: no PerformanceId
                  {
                    PerformanceAttributes: ["2D"],
                    UtcShowTime: "2026-07-28T15:00:00.000Z",
                  },
                  // dup of 2000 with the SAME startsAt
                  {
                    PerformanceId: 2000,
                    PerformanceAttributes: ["IMAX 70mm"],
                    UtcShowTime: "2026-07-28T14:00:00.000Z",
                  },
                ],
              },
            ],
          },
        ],
        movies: [],
        attributes: [],
        futureShows: [],
        datesWithShows: [],
      };

      const payload2 = {
        showDate: "2026-07-29T00:00:00",
        shows: [
          {
            TheatreCode: "1484",
            AdvertiseShowDate: "2026-07-29T00:00:00",
            UtcDate: "2026-07-29T07:00:00.000Z",
            Film: [
              {
                Title: "Test Movie",
                MasterMovieCode: "TEST123",
                Performances: [
                  // dup of 2000 with a DIFFERENT startsAt
                  {
                    PerformanceId: 2000,
                    PerformanceAttributes: ["IMAX 70mm"],
                    UtcShowTime: "2026-07-29T14:00:00.000Z",
                  },
                ],
              },
            ],
          },
        ],
        movies: [],
        attributes: [],
        futureShows: [],
        datesWithShows: [],
      };

      const { showtimes, stats } = parseRegalJsonWithStats([payload1, payload2]);

      expect(showtimes).toHaveLength(1);
      expect(stats).toEqual({
        performances: 5,
        kept: 1,
        noTime: 1,
        noId: 1,
        dupSameStart: 1,
        dupDifferentStart: 1,
      });
    });
  });
});
