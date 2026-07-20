import type { Adapter, NormalizedShowtime, TheatreLike } from "./types";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function formatYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function upperIncludes70mm(value: string | undefined | null): boolean {
  if (!value) return false;
  const upper = value.toUpperCase();
  return (
    upper.includes("70MM") || upper.includes("70 MM") || upper.includes("IMAX 70")
  );
}

// Defensive JSON walker: the exact shape of Regal's internal getShowtimes
// response is uncertain / undocumented, so we try several plausible key
// names at each level rather than assuming one fixed schema.

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

  // Sometimes the payload nests one level deeper, e.g. { data: { movies: [...] } }
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
    firstDefined<string>(movie, ["title", "Title", "name", "Name", "movieName"]) ??
    "Unknown";
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

async function fetchShowtimesForDate(
  externalId: string,
  ymd: string
): Promise<NormalizedShowtime[]> {
  const url = `https://www.regmovies.com/api/getShowtimes?theatres=${encodeURIComponent(
    externalId
  )}&date=${ymd}&hoCode=&ignoreCache=false&moviesOnly=false`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": CHROME_UA,
      },
    });

    if (!res.ok) {
      console.warn(`[regal adapter] non-2xx response (${res.status}) for ${externalId} on ${ymd}`);
      return [];
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      console.warn(
        `[regal adapter] unexpected content-type "${contentType}" for ${externalId} on ${ymd} (likely a Cloudflare challenge)`
      );
      return [];
    }

    const data = await res.json();
    const movies = findMoviesArray(data);
    const results: NormalizedShowtime[] = [];

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

        const externalIdForShowtime =
          id ?? `${hoCode ?? "unknown"}-${startsAt.toISOString()}`;

        results.push({
          externalId: externalIdForShowtime,
          startsAt,
          movieTitle: title,
          movieExternalId: hoCode,
          format: formatLabel || "Standard",
          is70mm,
          bookingUrl,
        });
      }
    }

    return results;
  } catch (err) {
    console.warn(
      `[regal adapter] fetch/parse failed for ${externalId} on ${ymd} (likely Cloudflare or JSON shape change):`,
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

export const regalAdapter: Adapter = {
  async fetchShowtimes(theatre: TheatreLike, days: number): Promise<NormalizedShowtime[]> {
    const results: NormalizedShowtime[] = [];
    const today = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const ymd = formatYmd(date);

      const dayResults = await fetchShowtimesForDate(theatre.externalId, ymd);
      results.push(...dayResults);
    }

    return results;
  },
};

export default regalAdapter;
