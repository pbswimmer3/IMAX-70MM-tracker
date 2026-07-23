import { describe, it, expect } from "vitest";
import {
  buildDigests,
  type DropRow,
  type SubRow,
} from "@/lib/digest";

describe("buildDigests", () => {
  it("includes an all-theatres sub (theatreId null) in drops from multiple theatres", () => {
    const drops: DropRow[] = [
      {
        movieId: "m1",
        theatreId: "t1",
        showDate: new Date("2026-07-21T20:00:00Z"),
        movieTitle: "Movie A",
        theatreName: "Theatre 1",
        city: "City A",
        bookingUrl: "http://example.com/1",
      },
      {
        movieId: "m1",
        theatreId: "t2",
        showDate: new Date("2026-07-21T20:00:00Z"),
        movieTitle: "Movie A",
        theatreName: "Theatre 2",
        city: "City B",
        bookingUrl: "http://example.com/2",
      },
    ];

    const subs: SubRow[] = [
      {
        userId: "user1",
        email: "user1@example.com",
        movieId: "m1",
        theatreId: null, // all theatres
      },
    ];

    const result = buildDigests(drops, subs);
    expect(result).toHaveLength(1);
    expect(result[0].items).toHaveLength(2);
    expect(result[0].items[0].theatreName).toBe("Theatre 1");
    expect(result[0].items[1].theatreName).toBe("Theatre 2");
  });

  it("only includes theatre-specific drops for theatre-specific subs", () => {
    const drops: DropRow[] = [
      {
        movieId: "m1",
        theatreId: "t1",
        showDate: new Date("2026-07-21T20:00:00Z"),
        movieTitle: "Movie A",
        theatreName: "Theatre 1",
        city: "City A",
        bookingUrl: "http://example.com/1",
      },
      {
        movieId: "m1",
        theatreId: "t2",
        showDate: new Date("2026-07-21T20:00:00Z"),
        movieTitle: "Movie A",
        theatreName: "Theatre 2",
        city: "City B",
        bookingUrl: "http://example.com/2",
      },
    ];

    const subs: SubRow[] = [
      {
        userId: "user1",
        email: "user1@example.com",
        movieId: "m1",
        theatreId: "t1", // specific theatre
      },
    ];

    const result = buildDigests(drops, subs);
    expect(result).toHaveLength(1);
    expect(result[0].items).toHaveLength(1);
    expect(result[0].items[0].theatreName).toBe("Theatre 1");
  });

  it("collapses multiple dates for same movie+theatre into one item with sorted dates", () => {
    const drops: DropRow[] = [
      {
        movieId: "m1",
        theatreId: "t1",
        showDate: new Date("2026-07-23T20:00:00Z"),
        movieTitle: "Movie A",
        theatreName: "Theatre 1",
        city: "City A",
        bookingUrl: "http://example.com/1",
      },
      {
        movieId: "m1",
        theatreId: "t1",
        showDate: new Date("2026-07-21T20:00:00Z"),
        movieTitle: "Movie A",
        theatreName: "Theatre 1",
        city: "City A",
        bookingUrl: "http://example.com/1",
      },
    ];

    const subs: SubRow[] = [
      {
        userId: "user1",
        email: "user1@example.com",
        movieId: "m1",
        theatreId: null,
      },
    ];

    const result = buildDigests(drops, subs);
    expect(result).toHaveLength(1);
    expect(result[0].items).toHaveLength(1);
    expect(result[0].items[0].dates).toHaveLength(2);
    expect(result[0].items[0].dates[0].getUTCDate()).toBe(21);
    expect(result[0].items[0].dates[1].getUTCDate()).toBe(23);
  });

  it("omits users with no matching drops", () => {
    const drops: DropRow[] = [
      {
        movieId: "m1",
        theatreId: "t1",
        showDate: new Date("2026-07-21T20:00:00Z"),
        movieTitle: "Movie A",
        theatreName: "Theatre 1",
        city: "City A",
        bookingUrl: "http://example.com/1",
      },
    ];

    const subs: SubRow[] = [
      {
        userId: "user1",
        email: "user1@example.com",
        movieId: "m2", // does not match any drop
        theatreId: null,
      },
    ];

    const result = buildDigests(drops, subs);
    expect(result).toHaveLength(0);
  });
});
