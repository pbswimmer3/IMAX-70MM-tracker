import { describe, it, expect } from "vitest";
import { parseRegalPayload, parseRegalJson } from "@/scraper/parseRegal";

// Shape mirrors the assumed getShowtimes schema documented at the top of
// parseRegal.ts (movies[].performances[]).
function payload(perfs: Array<{ id: string; start: string; experience: string }>) {
  return {
    movies: [
      {
        title: "The Odyssey",
        hoCode: "ho00019076",
        performances: perfs.map((p) => ({
          id: p.id,
          start: p.start,
          experience: p.experience,
          bookingUrl: `https://www.regmovies.com/checkout/${p.id}`,
        })),
      },
    ],
  };
}

describe("parseRegalPayload", () => {
  it("keeps non-70mm records with is70mm=false so empty-DATE detection stays correct", () => {
    // The regression this guards: if non-70mm were dropped here, a date where
    // the theatre is open but has no 70mm screening would return [] and
    // probeHorizon would treat it as the end of the booking window.
    const out = parseRegalPayload(
      payload([
        { id: "a", start: "2026-08-19T02:00:00Z", experience: "IMAX 70MM" },
        { id: "b", start: "2026-08-19T05:00:00Z", experience: "RealD 3D" },
      ])
    );

    expect(out).toHaveLength(2);
    expect(out.filter((s) => s.is70mm).map((s) => s.externalId)).toEqual(["a"]);
    expect(out.find((s) => s.externalId === "b")?.is70mm).toBe(false);
  });

  it("stamps the queried date as showDate (not the UTC day of startsAt)", () => {
    // 2026-08-19T02:00:00Z is 7:00 PM PDT on 2026-08-18. Keying off UTC would
    // file this drop one calendar day late; showDate carries the real day.
    const out = parseRegalPayload(
      payload([{ id: "a", start: "2026-08-19T02:00:00Z", experience: "IMAX 70MM" }]),
      "2026-08-18"
    );

    expect(out[0].showDate).toBe("2026-08-18");
    expect(out[0].startsAt).toBe("2026-08-19T02:00:00.000Z");
  });

  it("omits showDate when no queryDate is supplied", () => {
    const out = parseRegalPayload(
      payload([{ id: "a", start: "2026-08-19T02:00:00Z", experience: "IMAX 70MM" }])
    );
    expect(out[0].showDate).toBeUndefined();
  });

  it("detects 70mm from the title when the experience label lacks it", () => {
    const out = parseRegalPayload({
      movies: [
        {
          title: "The Odyssey in 70mm",
          hoCode: "ho00021807",
          performances: [{ id: "c", start: "2026-08-19T02:00:00Z" }],
        },
      ],
    });
    expect(out[0].is70mm).toBe(true);
    expect(out[0].format).toBe("70mm");
  });

  it("returns [] for an empty date payload", () => {
    expect(parseRegalPayload({ movies: [] }, "2026-08-20")).toEqual([]);
    expect(parseRegalPayload(null, "2026-08-20")).toEqual([]);
  });

  it("skips performances with a missing or unparseable start", () => {
    const out = parseRegalPayload({
      movies: [
        {
          title: "The Odyssey",
          hoCode: "ho00019076",
          performances: [
            { id: "a", experience: "IMAX 70MM" },
            { id: "b", start: "not-a-date", experience: "IMAX 70MM" },
            { id: "c", start: "2026-08-19T02:00:00Z", experience: "IMAX 70MM" },
          ],
        },
      ],
    });
    expect(out.map((s) => s.externalId)).toEqual(["c"]);
  });
});

describe("parseRegalJson (legacy multi-payload wrapper)", () => {
  it("still returns 70mm-only across payloads", () => {
    const out = parseRegalJson([
      payload([
        { id: "a", start: "2026-08-19T02:00:00Z", experience: "IMAX 70MM" },
        { id: "b", start: "2026-08-19T05:00:00Z", experience: "Standard" },
      ]),
      payload([{ id: "c", start: "2026-08-20T02:00:00Z", experience: "IMAX 70MM" }]),
    ]);

    expect(out.map((s) => s.externalId)).toEqual(["a", "c"]);
    expect(out.every((s) => s.is70mm)).toBe(true);
  });
});
