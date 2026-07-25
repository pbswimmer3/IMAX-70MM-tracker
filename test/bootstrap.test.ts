import { describe, it, expect, vi, beforeEach } from "vitest";

interface PrismaMock {
  theatre: {
    count: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  movie: {
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
}

function makePrismaMock(): PrismaMock {
  return {
    theatre: {
      count: vi.fn(),
      createMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    movie: {
      count: vi.fn(),
      create: vi.fn(),
    },
  };
}

describe("ensureBootstrapped", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("creates all theatres and the movie when the DB is empty", async () => {
    const prismaMock = makePrismaMock();
    prismaMock.theatre.count.mockResolvedValue(0);
    prismaMock.theatre.createMany.mockResolvedValue({ count: 6 });
    prismaMock.movie.count.mockResolvedValue(0);
    prismaMock.movie.create.mockResolvedValue({});

    vi.doMock("@/lib/prisma", () => ({ prisma: prismaMock }));
    const { ensureBootstrapped } = await import("@/lib/bootstrap");

    const result = await ensureBootstrapped();

    expect(result).toEqual({
      theatresCreated: 6,
      urlsBackfilled: 0,
      moviesCreated: 1,
      errors: [],
    });
    expect(prismaMock.theatre.createMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.theatre.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.movie.create).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when the DB is already fully populated", async () => {
    const prismaMock = makePrismaMock();
    prismaMock.theatre.count.mockResolvedValue(6);
    prismaMock.theatre.findUnique.mockResolvedValue({
      id: "t1",
      showtimesUrl: "https://existing.example.com/showtimes",
    });
    prismaMock.movie.count.mockResolvedValue(1);

    vi.doMock("@/lib/prisma", () => ({ prisma: prismaMock }));
    const { ensureBootstrapped } = await import("@/lib/bootstrap");

    const result = await ensureBootstrapped();

    expect(result).toEqual({
      theatresCreated: 0,
      urlsBackfilled: 0,
      moviesCreated: 0,
      errors: [],
    });
    expect(prismaMock.theatre.createMany).not.toHaveBeenCalled();
    expect(prismaMock.theatre.update).not.toHaveBeenCalled();
    expect(prismaMock.movie.create).not.toHaveBeenCalled();
  });

  it("backfills showtimesUrl only for rows where it is null/empty, never overwriting existing values", async () => {
    const prismaMock = makePrismaMock();
    prismaMock.theatre.count.mockResolvedValue(6);
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
    prismaMock.movie.count.mockResolvedValue(1);

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
});
