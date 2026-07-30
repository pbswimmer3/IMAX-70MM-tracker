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

// Normalizes a Regal theatre code for comparison. Tracked ids include
// leading-zero forms like "0347" (scraper/theatres.ts), but the parser was
// only ever validated against theatre 1484 — if Regal ever echoes TheatreCode
// as 347 (numeric) or "347" (no leading zero) for a theatre we track as
// "0347", a strict string compare would skip EVERY show and the run would log
// PASS with 0 showtimes: a silent failure indistinguishable from a real dark
// night. Stripping leading zeros makes the comparison tolerant of both forms.
function normalizeTheatreCode(code: string): string {
  return code.trim().replace(/^0+(?=\d)/, "");
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
  // Count of shows[] entries dropped because TheatreCode (after leading-zero
  // normalization) didn't match expectedTheatreCode. >0 on every attempted
  // date is the silent-failure signature this counter exists to catch.
  theatreMismatch: number;
}

// Parses one or more raw getShowtimes JSON payloads (one per date fetched)
// into normalized showtimes for EVERY performance (is70mm flag set per
// performance) plus parse stats. Deduped by PerformanceId: empirically unique
// per theatre (72 distinct ids over 14 dates at LA Live, dupDifferentStart=0),
// which is what Showtime.@@unique([theatreId, externalId]) relies on — if
// dupDifferentStart is ever >0 in the wild, PerformanceId is NOT safely unique
// per theatre and externalId needs rethinking.
//
// queryDate is the date the caller asked Regal about (only meaningful when
// payloads.length === 1, e.g. the per-date horizon walk in scrape.ts). It is
// used ONLY as a fallback for showDate when the payload carries no advertised
// date of its own — the payload's own AdvertiseShowDate/showDate always wins,
// since it is the theatre's real local calendar day for that show.
//
// seen is the externalId -> startsAt dedup map. It defaults to a fresh Map
// per call (self-contained, e.g. for parseRegalJson's multi-payload callers),
// but a caller that parses one date's payload at a time — scrape.ts's
// per-date horizon walk, via parseRegalDatePayload — must pass the SAME map
// across every date so a PerformanceId that reappears on a later date is
// still deduped; without hoisting it, dedup only ever spans one date's
// payload and cross-date duplicates silently collapse (last write wins).
export function parseRegalJsonWithStats(
  payloads: unknown[],
  expectedTheatreCode?: string,
  queryDate?: string,
  seen: Map<string, string> = new Map()
): { showtimes: NormalizedShowtimeLite[]; stats: RegalParseStats } {
  const results: NormalizedShowtimeLite[] = [];
  const stats: RegalParseStats = {
    performances: 0,
    kept: 0,
    noTime: 0,
    noId: 0,
    dupSameStart: 0,
    dupDifferentStart: 0,
    theatreMismatch: 0,
  };

  for (const payload of payloads) {
    if (!isObject(payload)) continue;

    for (const show of asArray(payload.shows)) {
      // getShowtimes?theatres= accepts a list; the caller attributes every
      // returned record to the one theatre it requested. Drop any entry that
      // names a different theatre so we never misattribute showtimes. Compare
      // with leading zeros normalized so "0347" (as tracked) and 347/"347"
      // (as Regal might echo it) are treated as the same theatre.
      const theatreCode = asString(show.TheatreCode);
      if (
        expectedTheatreCode &&
        theatreCode &&
        normalizeTheatreCode(theatreCode) !== normalizeTheatreCode(expectedTheatreCode)
      ) {
        stats.theatreMismatch++;
        continue;
      }

      const showDate =
        advertisedDateKey(show.AdvertiseShowDate) ??
        advertisedDateKey((payload as Record<string, unknown>).showDate) ??
        queryDate;

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

// Parses ONE date's raw getShowtimes payload — the shape probeHorizon's
// per-date fetchDate deals in (see scrape.ts's scrapeRegal). Thin wrapper over
// parseRegalJsonWithStats with a single-element payload array. Pass the SAME
// `seen` map on every call across one theatre's walk so PerformanceId dedup
// spans dates, not just the one date being parsed right now (see
// parseRegalJsonWithStats' doc comment on `seen`).
export function parseRegalDatePayload(
  payload: unknown,
  expectedTheatreCode?: string,
  queryDate?: string,
  seen?: Map<string, string>
): { showtimes: NormalizedShowtimeLite[]; stats: RegalParseStats } {
  return parseRegalJsonWithStats([payload], expectedTheatreCode, queryDate, seen);
}
