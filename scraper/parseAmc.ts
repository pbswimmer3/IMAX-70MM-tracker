import type { NormalizedShowtimeLite } from "./types";

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

// AMC's __NEXT_DATA__ shape is undocumented and can change across deploys, so
// we recursively search for the first array of "showtime-like" objects
// (heuristic: at least one entry that looks like it has a movie name and a
// date/time field) rather than assuming one fixed path. We assumed the array
// most likely lives under props.pageProps (Next.js convention) but this
// walker will find it anywhere in the tree.
const MOVIE_NAME_KEYS = ["movieName", "movieTitle", "name", "title"];
const DATETIME_KEYS = [
  "showDateTimeUtc",
  "showDateTimeLocal",
  "showtime",
  "startDateTime",
  "dateTime",
  "showTime",
];

function looksLikeShowtime(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const hasMovieName = MOVIE_NAME_KEYS.some((k) => typeof value[k] === "string");
  const hasDateTime = DATETIME_KEYS.some((k) => typeof value[k] === "string");
  return hasMovieName && hasDateTime;
}

export function findShowtimesArray(obj: unknown, depth = 0): Record<string, unknown>[] | null {
  if (depth > 12 || obj === null || obj === undefined) return null;

  if (Array.isArray(obj)) {
    if (obj.length > 0 && obj.every((entry) => looksLikeShowtime(entry))) {
      return obj as Record<string, unknown>[];
    }
    for (const entry of obj) {
      const found = findShowtimesArray(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (isObject(obj)) {
    // Prefer conventional Next.js nesting first.
    const pageProps = (obj as Record<string, unknown>).pageProps;
    if (depth === 0 && isObject(pageProps)) {
      const found = findShowtimesArray(pageProps, depth + 1);
      if (found) return found;
    }
    for (const key of Object.keys(obj)) {
      const found = findShowtimesArray((obj as Record<string, unknown>)[key], depth + 1);
      if (found) return found;
    }
  }

  return null;
}

function extractAttributeStrings(entry: Record<string, unknown>): string[] {
  const out: string[] = [];
  const embedded = entry._embedded;
  const attrSources: unknown[] = [
    entry.attributes,
    isObject(embedded) ? (embedded as Record<string, unknown>).attributes : undefined,
  ];
  for (const source of attrSources) {
    if (!Array.isArray(source)) continue;
    for (const attr of source) {
      if (typeof attr === "string") {
        out.push(attr);
      } else if (isObject(attr)) {
        if (typeof attr.code === "string") out.push(attr.code);
        if (typeof attr.name === "string") out.push(attr.name);
      }
    }
  }
  return out;
}

export function parseAmcNextData(json: unknown): NormalizedShowtimeLite[] {
  const showtimesArray = findShowtimesArray(json);
  if (!showtimesArray) return [];

  const results: NormalizedShowtimeLite[] = [];

  for (const entry of showtimesArray) {
    const id = firstDefined<string | number>(entry, ["id", "showtimeId", "sessionId"]);
    const movieTitle =
      firstDefined<string>(entry, MOVIE_NAME_KEYS) ?? "Unknown";
    const movieExternalIdRaw = firstDefined<string | number>(entry, [
      "movieId",
      "filmId",
    ]);
    const rawDate = firstDefined<string>(entry, DATETIME_KEYS);
    if (!rawDate) continue;
    const startsAt = new Date(rawDate);
    if (Number.isNaN(startsAt.getTime())) continue;

    const bookingUrl = firstDefined<string>(entry, [
      "purchaseUrl",
      "ticketUrl",
      "bookingUrl",
      "url",
    ]);
    const premiumFormat = firstDefined<string>(entry, ["premiumFormat", "format"]);
    const attributeStrings = extractAttributeStrings(entry);

    const is70mm =
      attributeStrings.some(upperIncludes70mm) || upperIncludes70mm(premiumFormat);

    if (!is70mm) continue;

    const formatLabel =
      attributeStrings.length > 0 ? attributeStrings.join(", ") : premiumFormat || "70mm";

    const externalId =
      id !== undefined
        ? String(id)
        : `${movieTitle}-${startsAt.toISOString()}`;

    results.push({
      externalId,
      startsAt: startsAt.toISOString(),
      movieTitle,
      movieExternalId:
        movieExternalIdRaw !== undefined ? String(movieExternalIdRaw) : undefined,
      format: formatLabel,
      is70mm: true,
      bookingUrl,
    });
  }

  return results;
}
