import { prisma } from "@/lib/prisma";
import { THEATRES, ODYSSEY_MOVIE } from "@/lib/theatres";
import type { Prisma } from "@prisma/client";

export interface BootstrapResult {
  theatresCreated: number;
  urlsBackfilled: number;
  moviesCreated: number;
  errors: string[];
}

// Module-level guard: the DB existence check should run at most once per warm
// serverless instance. Caches the in-flight/resolved promise; any failure —
// a rejection, or a resolved result carrying errors (runBootstrap catches
// internally, so a transient DB blip lands here, not in .catch) — clears the
// cache so the next call retries instead of replaying it for the instance's
// whole life.
let inFlight: Promise<BootstrapResult> | null = null;

// Self-healing seed: creates the theatre/movie rows this tracker depends on
// if they're missing (e.g. schema was pushed but db:seed was never run
// against prod), without ever overwriting an operator's existing data. Never
// throws — all failures are caught and surfaced via the returned `errors`.
//
// Unconditionally idempotent: every run does createMany({ skipDuplicates })
// for theatres and an upsert (update: {}) for the movie, rather than gating
// on a row count. This is deliberate: two cold-started serverless instances
// racing to bootstrap the same empty DB both observed count===0 under the
// old count-gated version, and the loser's createMany/create threw a unique
// constraint error that surfaced as a pipeline error. It also healed a
// partially-seeded table (e.g. old seed ids) that the count-gated version
// would silently leave half-populated forever. The trade-off: a theatre row
// an operator deliberately deleted from THEATRES' seed set will be recreated
// on the next bootstrap — accepted as the cost of race-safety and partial-set
// healing.
export function ensureBootstrapped(): Promise<BootstrapResult> {
  if (!inFlight) {
    inFlight = runBootstrap()
      .then((result) => {
        if (result.errors.length > 0) inFlight = null;
        return result;
      })
      .catch((err) => {
        inFlight = null;
        return {
          theatresCreated: 0,
          urlsBackfilled: 0,
          moviesCreated: 0,
          errors: [`bootstrap failed: ${err instanceof Error ? err.message : String(err)}`],
        };
      });
  }
  return inFlight;
}

async function runBootstrap(): Promise<BootstrapResult> {
  const errors: string[] = [];
  let theatresCreated = 0;
  let urlsBackfilled = 0;
  let moviesCreated = 0;

  try {
    const created = await prisma.theatre.createMany({
      data: THEATRES.map((t) => ({
        chain: t.chain,
        name: t.name,
        city: t.city,
        externalId: t.externalId,
        priority: t.priority,
        showtimesUrl: t.showtimesUrl,
      })),
      skipDuplicates: true,
    });
    theatresCreated = created.count;
  } catch (err) {
    errors.push(`theatre bootstrap failed: ${err instanceof Error ? err.message : err}`);
  }

  for (const seed of THEATRES) {
    try {
      const existing = await prisma.theatre.findUnique({
        where: { chain_externalId: { chain: seed.chain, externalId: seed.externalId } },
      });
      if (existing && (!existing.showtimesUrl || existing.showtimesUrl.length === 0)) {
        await prisma.theatre.update({
          where: { id: existing.id },
          data: { showtimesUrl: seed.showtimesUrl },
        });
        urlsBackfilled++;
      }
    } catch (err) {
      errors.push(
        `theatre backfill failed (${seed.chain}/${seed.externalId}): ${
          err instanceof Error ? err.message : err
        }`
      );
    }
  }

  try {
    const existingMovie = await prisma.movie.findUnique({ where: { slug: ODYSSEY_MOVIE.slug } });
    await prisma.movie.upsert({
      where: { slug: ODYSSEY_MOVIE.slug },
      update: {},
      create: {
        title: ODYSSEY_MOVIE.title,
        slug: ODYSSEY_MOVIE.slug,
        active: ODYSSEY_MOVIE.active,
        matchers: ODYSSEY_MOVIE.matchers as unknown as Prisma.InputJsonValue,
      },
    });
    if (!existingMovie) moviesCreated = 1;
  } catch (err) {
    errors.push(`movie bootstrap failed: ${err instanceof Error ? err.message : err}`);
  }

  return { theatresCreated, urlsBackfilled, moviesCreated, errors };
}
