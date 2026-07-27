import { describe, it, expect, vi, beforeEach } from "vitest";
import { ODYSSEY_MOVIE } from "@/lib/theatres";

// A non-empty, matchesMovie-usable matcher set — used wherever a test's
// existing movie row should NOT trigger the inert-matchers repair, so those
// tests stay focused on their original (non-matchers) assertions.
const USABLE_MATCHERS = { amc: { movieIds: ["76238"] }, regal: { hoCodes: ["ho00019076"] } };

// The exact inert default template the /movies UI used to ship — a row
// created through it can never match a showtime.
const INERT_MATCHERS = {
  amc: { attributeCodes: ["IMAX70MM", "70MM"], titlePattern: "" },
  regal: { hoCodes: [], titlePattern: "" },
};

interface PrismaMock {
  theatre: {
    createMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  movie: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

function makePrismaMock(): PrismaMock {
  return {
    theatre: {
      createMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    movie: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe("ensureBootstrapped", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("creates all theatres and the movie when the DB is empty", async () => {
    const prismaMock = makePrismaMock();
    prismaMock.theatre.createMany.mockResolvedValue({ count: 6 });
    prismaMock.theatre.findUnique.mockResolvedValue(null);
    prismaMock.movie.findUnique.mockResolvedValue(null);
    prismaMock.movie.upsert.mockResolvedValue({});

    vi.doMock("@/lib/prisma", () => ({ prisma: prismaMock }));
    const { ensureBootstrapped } = await import("@/lib/bootstrap");

    const result = await ensureBootstrapped();

    expect(result).toEqual({
      theatresCreated: 6,
      urlsBackfilled: 0,
      moviesCreated: 1,
      matchersRepaired: 0,
      errors: [],
    });
    expect(prismaMock.theatre.createMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.theatre.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true })
    );
    expect(prismaMock.movie.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.movie.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} })
    );
  });

  it("writes nothing new when the DB is already fully populated", async () => {
    const prismaMock = makePrismaMock();
    // skipDuplicates: every seed row already exists, so nothing is created.
    prismaMock.theatre.createMany.mockResolvedValue({ count: 0 });
    prismaMock.theatre.findUnique.mockResolvedValue({
      id: "t1",
      showtimesUrl: "https://existing.example.com/showtimes",
    });
    prismaMock.movie.findUnique.mockResolvedValue({
      id: "m1",
      slug: "the-odyssey",
      matchers: USABLE_MATCHERS,
    });
    prismaMock.movie.upsert.mockResolvedValue({ id: "m1" });

    vi.doMock("@/lib/prisma", () => ({ prisma: prismaMock }));
    const { ensureBootstrapped } = await import("@/lib/bootstrap");

    const result = await ensureBootstrapped();

    expect(result).toEqual({
      theatresCreated: 0,
      urlsBackfilled: 0,
      moviesCreated: 0,
      matchersRepaired: 0,
      errors: [],
    });
    expect(prismaMock.theatre.update).not.toHaveBeenCalled();
    // The movie upsert still runs (idempotent no-op) but must not resurrect
    // active/matchers on a row the operator already edited.
    expect(prismaMock.movie.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.movie.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} })
    );
    expect(prismaMock.movie.update).not.toHaveBeenCalled();
  });

  it("heals a partially-populated table (old seed ids) by creating the missing new-slug rows", async () => {
    const prismaMock = makePrismaMock();
    // Table is non-empty (old TODO-id rows exist) but none of THEATRES' rows
    // do yet, so all 6 get created via skipDuplicates.
    prismaMock.theatre.createMany.mockResolvedValue({ count: 6 });
    prismaMock.theatre.findUnique.mockResolvedValue({
      id: "t-new",
      showtimesUrl: "https://www.amctheatres.com/movie-theatres/san-francisco/amc-metreon-16/showtimes",
    });
    prismaMock.movie.findUnique.mockResolvedValue(null);
    prismaMock.movie.upsert.mockResolvedValue({});

    vi.doMock("@/lib/prisma", () => ({ prisma: prismaMock }));
    const { ensureBootstrapped } = await import("@/lib/bootstrap");

    const result = await ensureBootstrapped();

    expect(result.theatresCreated).toBe(6);
    expect(result.errors).toEqual([]);
    expect(prismaMock.theatre.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true })
    );
  });

  it("backfills showtimesUrl only for rows where it is null/empty, never overwriting existing values", async () => {
    const prismaMock = makePrismaMock();
    prismaMock.theatre.createMany.mockResolvedValue({ count: 0 });
    prismaMock.theatre.findUnique.mockImplementation(
      ({ where }: { where: { chain_externalId: { chain: string; externalId: string } } }) => {
        const { externalId } = where.chain_externalId;
        if (externalId === "amc-metreon-16") {
          return Promise.resolve({ id: "t-metreon", showtimesUrl: null });
        }
        return Promise.resolve({
          id: `t-${externalId}`,
          showtimesUrl: "https://existing.example.com/showtimes",
        });
      }
    );
    prismaMock.theatre.update.mockResolvedValue({});
    prismaMock.movie.findUnique.mockResolvedValue({ id: "m1", matchers: USABLE_MATCHERS });
    prismaMock.movie.upsert.mockResolvedValue({ id: "m1" });

    vi.doMock("@/lib/prisma", () => ({ prisma: prismaMock }));
    const { ensureBootstrapped } = await import("@/lib/bootstrap");

    const result = await ensureBootstrapped();

    expect(result.theatresCreated).toBe(0);
    expect(result.urlsBackfilled).toBe(1);
    expect(result.moviesCreated).toBe(0);
    expect(result.errors).toEqual([]);
    expect(prismaMock.theatre.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.theatre.update).toHaveBeenCalledWith({
      where: { id: "t-metreon" },
      data: { showtimesUrl: expect.stringContaining("amc-metreon-16") },
    });
  });

  it("never overwrites a non-empty showtimesUrl even when other fields would differ", async () => {
    const prismaMock = makePrismaMock();
    prismaMock.theatre.createMany.mockResolvedValue({ count: 0 });
    prismaMock.theatre.findUnique.mockResolvedValue({
      id: "t1",
      showtimesUrl: "https://custom.example.com/showtimes",
    });
    prismaMock.movie.findUnique.mockResolvedValue({ id: "m1", matchers: USABLE_MATCHERS });
    prismaMock.movie.upsert.mockResolvedValue({ id: "m1" });

    vi.doMock("@/lib/prisma", () => ({ prisma: prismaMock }));
    const { ensureBootstrapped } = await import("@/lib/bootstrap");

    const result = await ensureBootstrapped();

    expect(result.urlsBackfilled).toBe(0);
    expect(prismaMock.theatre.update).not.toHaveBeenCalled();
  });

  it("clears the inFlight cache on a resolved result carrying errors, so the next call retries", async () => {
    const prismaMock = makePrismaMock();
    prismaMock.theatre.createMany.mockResolvedValue({ count: 0 });
    // First call: one seed's backfill lookup throws, producing a non-empty
    // errors[] on an otherwise-resolved (not rejected) promise.
    prismaMock.theatre.findUnique
      .mockRejectedValueOnce(new Error("transient db blip"))
      .mockResolvedValue({ id: "t1", showtimesUrl: "https://existing.example.com/showtimes" });
    prismaMock.movie.findUnique.mockResolvedValue({ id: "m1", matchers: USABLE_MATCHERS });
    prismaMock.movie.upsert.mockResolvedValue({ id: "m1" });

    vi.doMock("@/lib/prisma", () => ({ prisma: prismaMock }));
    const { ensureBootstrapped } = await import("@/lib/bootstrap");

    const first = await ensureBootstrapped();
    expect(first.errors.length).toBeGreaterThan(0);
    expect(prismaMock.theatre.createMany).toHaveBeenCalledTimes(1);

    const second = await ensureBootstrapped();
    expect(second.errors).toEqual([]);
    // A retry re-ran the whole bootstrap rather than replaying the cached
    // errored result.
    expect(prismaMock.theatre.createMany).toHaveBeenCalledTimes(2);
  });

  it("repairs the seeded movie's matchers when they are inert", async () => {
    const prismaMock = makePrismaMock();
    prismaMock.theatre.createMany.mockResolvedValue({ count: 0 });
    prismaMock.theatre.findUnique.mockResolvedValue({
      id: "t1",
      showtimesUrl: "https://existing.example.com/showtimes",
    });
    prismaMock.movie.findUnique.mockResolvedValue({
      id: "m1",
      slug: "the-odyssey",
      matchers: INERT_MATCHERS,
    });
    prismaMock.movie.upsert.mockResolvedValue({ id: "m1" });
    prismaMock.movie.update.mockResolvedValue({ id: "m1" });

    vi.doMock("@/lib/prisma", () => ({ prisma: prismaMock }));
    const { ensureBootstrapped } = await import("@/lib/bootstrap");

    const result = await ensureBootstrapped();

    expect(result.matchersRepaired).toBe(1);
    expect(result.errors).toEqual([]);
    expect(prismaMock.movie.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.movie.update).toHaveBeenCalledWith({
      where: { slug: ODYSSEY_MOVIE.slug },
      data: { matchers: ODYSSEY_MOVIE.matchers },
    });
  });

  it("does not touch the seeded movie's matchers when they are already usable", async () => {
    const prismaMock = makePrismaMock();
    prismaMock.theatre.createMany.mockResolvedValue({ count: 0 });
    prismaMock.theatre.findUnique.mockResolvedValue({
      id: "t1",
      showtimesUrl: "https://existing.example.com/showtimes",
    });
    prismaMock.movie.findUnique.mockResolvedValue({
      id: "m1",
      slug: "the-odyssey",
      matchers: USABLE_MATCHERS,
    });
    prismaMock.movie.upsert.mockResolvedValue({ id: "m1" });

    vi.doMock("@/lib/prisma", () => ({ prisma: prismaMock }));
    const { ensureBootstrapped } = await import("@/lib/bootstrap");

    const result = await ensureBootstrapped();

    expect(result.matchersRepaired).toBe(0);
    expect(prismaMock.movie.update).not.toHaveBeenCalled();
  });

  it("only ever queries/updates the ODYSSEY_MOVIE slug, never another movie row", async () => {
    const prismaMock = makePrismaMock();
    prismaMock.theatre.createMany.mockResolvedValue({ count: 0 });
    prismaMock.theatre.findUnique.mockResolvedValue({
      id: "t1",
      showtimesUrl: "https://existing.example.com/showtimes",
    });
    prismaMock.movie.findUnique.mockResolvedValue({
      id: "m1",
      slug: ODYSSEY_MOVIE.slug,
      matchers: INERT_MATCHERS,
    });
    prismaMock.movie.upsert.mockResolvedValue({ id: "m1" });
    prismaMock.movie.update.mockResolvedValue({ id: "m1" });

    vi.doMock("@/lib/prisma", () => ({ prisma: prismaMock }));
    const { ensureBootstrapped } = await import("@/lib/bootstrap");

    await ensureBootstrapped();

    expect(prismaMock.movie.findUnique).toHaveBeenCalledWith({
      where: { slug: ODYSSEY_MOVIE.slug },
    });
    expect(prismaMock.movie.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: ODYSSEY_MOVIE.slug } })
    );
  });
});
