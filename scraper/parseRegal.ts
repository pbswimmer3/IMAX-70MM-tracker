import type { NormalizedShowtimeLite } from "./types";

// Parser for Regal's /api/getShowtimes payload. VALIDATED 2026-07-28 against a
// real response from theatre 1484 (LA Live) captured from a residential IP.
// Real shape (one request = one show date):
//   { showDate, shows: [ { TheatreCode, AdvertiseShowDate, UtcDate, Film: [
//       { Title, MasterMovieCode, Performances: [
//           { PerformanceId, PerformanceAttributes: string[], CalendarShowTime,
//             UtcShowTime, UnixTime, StopSales, Auditorium, PerformanceGroup }
//       ] } ] } ],
//     movies: [...], attributes: [...], futureShows: [...], datesWithShows: [...] }
// 70mm lives in PerformanceAttributes as "IMAX 70mm" or "70mm" — NOT on the
// movie, which lists every format the film plays in anywhere (RelatedFormats).

const SEVENTY_MM = /70\s*mm/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

// Picks the label to store as `format`. Prefers the richest 70mm attribute
// ("IMAX 70mm" over a bare "70mm") so the dashboard/email shows the real
// presentation.
function pick70mmLabel(attributes: string[]): string | undefined {
  const matches = attributes.filter((a) => SEVENTY_MM.test(a));
  if (matches.length === 0) return undefined;
  const imax = matches.find((a) => /imax/i.test(a));
  return imax ?? matches[0];
}

// Regal's AdvertiseShowDate ("2026-07-28T00:00:00", no zone) is the theatre's
// local calendar date for the show — the correct key for per-date drop events.
// Taking the leading YYYY-MM-DD avoids any Date() zone shifting.
function advertisedDateKey(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return match ? match[1] : undefined;
}

// Matches a trailing zone designator (Z or +/-HH:MM / +/-HHMM). Regal's
// UtcShowTime is documented as UTC but sometimes arrives with no zone suffix;
// without one, `new Date(...)` parses it as HOST-LOCAL time (spec behavior),
// silently shifting every time by the scraper machine's UTC offset.
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/;

// Below this, a numeric timestamp is almost certainly epoch SECONDS, not ms
// (1e11 ms is the year 1973; 1e11 seconds is the year 5138) — guards against
// a payload that ever emits UnixTime in seconds producing a valid-looking but
// wildly wrong 1970-ish Date that would otherwise pass the NaN check below.
const MIN_MS_EPOCH = 1e11;

function startsAtIso(perf: Record<string, unknown>): string | undefined {
  const utc = asString(perf.UtcShowTime);
  if (utc) {
    const withZone = HAS_ZONE.test(utc) ? utc : `${utc}Z`;
    const parsed = new Date(withZone);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  // UnixTime is normally epoch milliseconds; only used if UtcShowTime is missing/bad.
  const unix = perf.UnixTime;
  if (typeof unix === "number" && Number.isFinite(unix)) {
    const ms = Math.abs(unix) < MIN_MS_EPOCH ? unix * 1000 : unix;
    const parsed = new Date(ms);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return undefined;
}

// Per-run counters so a broken parser (everything dropped) is distinguishable
// from a genuinely 70mm-less/showtime-less night. See parseRegalJsonWithStats.
export interface RegalParseStats {
  performances: number;
  kept: number;
  noTime: number;
  noId: number;
  dupSameStart: number;
  dupDifferentStart: number;
}

// Parses one or more raw getShowtimes JSON payloads (one per date fetched)
// into normalized showtimes for EVERY performance (is70mm flag set per
// performance) plus parse stats. Deduped by PerformanceId: empirically unique
// per theatre (72 distinct ids over 14 dates at LA Live, dupDifferentStart=0),
// which is what Showtime.@@unique([theatreId, externalId]) relies on — if
// dupDifferentStart is ever >0 in the wild, PerformanceId is NOT safely unique
// per theatre and externalId needs rethinking.
export function parseRegalJsonWithStats(
  payloads: unknown[],
  expectedTheatreCode?: string
): { showtimes: NormalizedShowtimeLite[]; stats: RegalParseStats } {
  const results: NormalizedShowtimeLite[] = [];
  const seen = new Map<string, string>(); // externalId -> startsAt
  const stats: RegalParseStats = {
    performances: 0,
    kept: 0,
    noTime: 0,
    noId: 0,
    dupSameStart: 0,
    dupDifferentStart: 0,
  };

  for (const payload of payloads) {
    if (!isObject(payload)) continue;

    for (const show of asArray(payload.shows)) {
      // getShowtimes?theatres= accepts a list; the caller attributes every
      // returned record to the one theatre it requested. Drop any entry that
      // names a different theatre so we never misattribute showtimes.
      const theatreCode = asString(show.TheatreCode);
      if (
        expectedTheatreCode &&
        theatreCode &&
        theatreCode.trim() !== expectedTheatreCode.trim()
      ) {
        continue;
      }

      const showDate =
        advertisedDateKey(show.AdvertiseShowDate) ??
        advertisedDateKey((payload as Record<string, unknown>).showDate);

      for (const film of asArray(show.Film)) {
        const movieTitle = asString(film.Title) ?? "Unknown";
        const movieExternalId = asString(film.MasterMovieCode);

        for (const perf of asArray(film.Performances)) {
          stats.performances++;

          const attributes = Array.isArray(perf.PerformanceAttributes)
            ? perf.PerformanceAttributes.filter(
                (a): a is string => typeof a === "string"
              )
            : [];

          const seventyMmLabel = pick70mmLabel(attributes);
          const is70mm = Boolean(seventyMmLabel);
          const performanceGroup = asString(perf.PerformanceGroup);
          const format = seventyMmLabel ?? performanceGroup ?? "Standard";

          const startsAt = startsAtIso(perf);
          if (!startsAt) {
            stats.noTime++;
            continue;
          }

          const externalId = asString(perf.PerformanceId);
          if (!externalId) {
            stats.noId++;
            continue;
          }
          const priorStartsAt = seen.get(externalId);
          if (priorStartsAt !== undefined) {
            if (priorStartsAt === startsAt) stats.dupSameStart++;
            else stats.dupDifferentStart++;
            continue;
          }
          seen.set(externalId, startsAt);

          results.push({
            externalId,
            startsAt,
            movieTitle,
            movieExternalId,
            format,
            is70mm,
            ...(showDate ? { showDate } : {}),
          });
          stats.kept++;
        }
      }
    }
  }

  return { showtimes: results, stats };
}

// Thin wrapper kept for callers that only need the array (scrape.ts's POST
// path filters is70mm itself; tests use this directly).
export function parseRegalJson(
  payloads: unknown[],
  expectedTheatreCode?: string
): NormalizedShowtimeLite[] {
  return parseRegalJsonWithStats(payloads, expectedTheatreCode).showtimes;
}
