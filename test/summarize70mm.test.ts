import { describe, it, expect } from "vitest";
import { summarize70mm } from "@/scraper/summarize70mm";
import type { NormalizedShowtimeLite } from "@/scraper/types";

function showtime(overrides: Partial<NormalizedShowtimeLite>): NormalizedShowtimeLite {
  return {
    externalId: "1",
    startsAt: "2026-07-26T19:00:00.000Z",
    movieTitle: "The Odyssey",
    movieExternalId: "76238",
    format: "IMAX 70MM",
    is70mm: true,
    ...overrides,
  };
}

describe("summarize70mm", () => {
  it("groups by movieTitle/movieExternalId/format and counts each group", () => {
    const groups = summarize70mm([
      showtime({ externalId: "1" }),
      showtime({ externalId: "2" }),
      showtime({ externalId: "3", movieTitle: "", movieExternalId: "the-odyssey-76238", format: "70MM" }),
    ]);

    expect(groups).toHaveLength(2);
    const odyssey = groups.find((g) => g.movieTitle === "The Odyssey");
    expect(odyssey?.count).toBe(2);
    expect(odyssey?.samples.map((s) => s.externalId)).toEqual(["1", "2"]);
  });

  it("sorts groups by count descending", () => {
    const groups = summarize70mm([
      showtime({ externalId: "1", movieTitle: "A" }),
      showtime({ externalId: "2", movieTitle: "B" }),
      showtime({ externalId: "3", movieTitle: "B" }),
      showtime({ externalId: "4", movieTitle: "B" }),
    ]);

    expect(groups.map((g) => g.movieTitle)).toEqual(["B", "A"]);
    expect(groups[0].count).toBe(3);
    expect(groups[1].count).toBe(1);
  });

  it("keeps only up to 2 samples per group even when the group is larger", () => {
    const groups = summarize70mm([
      showtime({ externalId: "1" }),
      showtime({ externalId: "2" }),
      showtime({ externalId: "3" }),
    ]);
    expect(groups[0].count).toBe(3);
    expect(groups[0].samples).toHaveLength(2);
  });

  it("ignores non-70mm records", () => {
    const groups = summarize70mm([
      showtime({ externalId: "1", is70mm: false }),
      showtime({ externalId: "2" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(1);
  });

  it("keeps an empty-string title distinct from an undefined movieExternalId group", () => {
    const groups = summarize70mm([
      showtime({ externalId: "1", movieTitle: "", movieExternalId: undefined }),
      showtime({ externalId: "2", movieTitle: "The Odyssey", movieExternalId: undefined }),
    ]);
    expect(groups).toHaveLength(2);
    const blankTitle = groups.find((g) => g.movieTitle === "");
    expect(blankTitle).toBeDefined();
    expect(blankTitle?.movieExternalId).toBeUndefined();
    const odyssey = groups.find((g) => g.movieTitle === "The Odyssey");
    expect(odyssey?.movieExternalId).toBeUndefined();
  });
});
