import type { NormalizedShowtimeLite } from "./types";

// Defensive JSON walker mirroring lib/adapters/regal.ts: the exact shape of
// Regal's internal getShowtimes response is uncertain / undocumented, so we
// try several plausible key names at each level rather than assuming one
// fixed schema. Assumed keys (verify against real payloads in CI):
//   movies array:      movies | Movies | results | data | films
//   per-movie title:   title | Title | name | Name | movieName
//   per-movie id:      hoCode | HOCode | ho | hocode | filmId | movieId
//   performances array: performances | showtimes | Performances | Showtimes | sessions
//   per-perf id:        id | Id | performanceId | sessionId
//   per-perf start:     start | Start | startDateTime | showDateTime | showtime | dateTime
//   per-perf url:       bookingUrl | purchaseUrl | ticketUrl | url | link
//   per-perf format:    experience | format | attribute | attributeLabel | presentationMethod | type

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function upperIncludes70mm(value: string | undefined | null): boolean {
  if (!value) return false;
  const upper = value.toUpperCase();
  return (
    upper.includes("70MM") || upper.includes("70 MM") || upper.includes("IMAX 70")
  );
}

function firstDefined<T = unknown>(obj: Record<string, unknown>, keys: string[]): T | undefined {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key] as T;
  }
  return undefined;
}

function findMoviesArray(data: unknown): Record<string, unknown>[] {
  if (!isObject(data)) return [];

  const candidateKeys = ["movies", "Movies", "results", "data", "films"];
  for (const key of candidateKeys) {
    const candidate = (data as Record<string, unknown>)[key];
    if (Array.isArray(candidate)) {
      return candidate.filter(isObject) as Record<string, unknown>[];
    }
  }

  for (const key of candidateKeys) {
    const nested = (data as Record<string, unknown>)[key];
    if (isObject(nested)) {
      const inner = findMoviesArray(nested);
      if (inner.length > 0) return inner;
    }
  }

  return [];
}

function findPerformancesArray(movie: Record<string, unknown>): Record<string, unknown>[] {
  const candidateKeys = [
    "performances",
    "showtimes",
    "Performances",
    "Showtimes",
    "sessions",
  ];
  for (const key of candidateKeys) {
    const candidate = movie[key];
    if (Array.isArray(candidate)) {
      return candidate.filter(isObject) as Record<string, unknown>[];
    }
  }
  return [];
}

function extractMovieMeta(movie: Record<string, unknown>): {
  title: string;
  hoCode: string | undefined;
} {
  const title =
    firstDefined<string>(movie, ["title", "Title", "name", "Name", "movieName"]) ?? "Unknown";
  const hoCode = firstDefined<string>(movie, [
    "hoCode",
    "HOCode",
    "ho",
    "hocode",
    "filmId",
    "movieId",
  ]);
  return { title, hoCode };
}

function extractPerformanceMeta(perf: Record<string, unknown>): {
  id: string | undefined;
  startsAtRaw: string | undefined;
  bookingUrl: string | undefined;
  formatLabel: string;
} {
  const id = firstDefined<string | number>(perf, ["id", "Id", "performanceId", "sessionId"]);
  const startsAtRaw = firstDefined<string>(perf, [
    "start",
    "Start",
    "startDateTime",
    "showDateTime",
    "showtime",
    "dateTime",
  ]);
  const bookingUrl = firstDefined<string>(perf, [
    "bookingUrl",
    "purchaseUrl",
    "ticketUrl",
    "url",
    "link",
  ]);
  const formatLabel =
    firstDefined<string>(perf, [
      "experience",
      "format",
      "attribute",
      "attributeLabel",
      "presentationMethod",
      "type",
    ]) ?? "";

  return {
    id: id !== undefined ? String(id) : undefined,
    startsAtRaw,
    bookingUrl,
    formatLabel,
  };
}

// Parses one or more raw getShowtimes JSON payloads (one per date fetched)
// into normalized 70mm-only showtimes.
export function parseRegalJson(payloads: unknown[]): NormalizedShowtimeLite[] {
  const results: NormalizedShowtimeLite[] = [];

  for (const payload of payloads) {
    const movies = findMoviesArray(payload);

    for (const movie of movies) {
      const { title, hoCode } = extractMovieMeta(movie);
      const performances = findPerformancesArray(movie);

      for (const perf of performances) {
        const { id, startsAtRaw, bookingUrl, formatLabel } = extractPerformanceMeta(perf);
        if (!startsAtRaw) continue;

        const startsAt = new Date(startsAtRaw);
        if (Number.isNaN(startsAt.getTime())) continue;

        const is70mm =
          upperIncludes70mm(formatLabel) || upperIncludes70mm(title);
        if (!is70mm) continue;

        const externalId = id ?? `${hoCode ?? "unknown"}-${startsAt.toISOString()}`;

        results.push({
          externalId,
          startsAt: startsAt.toISOString(),
          movieTitle: title,
          movieExternalId: hoCode,
          format: formatLabel || "70mm",
          is70mm: true,
          bookingUrl,
        });
      }
    }
  }

  return results;
}
