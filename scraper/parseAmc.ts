import type { NormalizedShowtimeLite } from "./types";

/**
 * AMC theatre showtimes pages are Next.js App Router: the showtime data is
 * serialized into the streaming RSC payload (self.__next_f.push([...])), not a
 * clean JSON blob. Each showtime renders as:
 *
 *   {"showtime":{"showtimeId":145182280,...,"showDateTimeUtc":"2026-07-21T04:00:00.000Z",
 *     "display":{"time":"9:00","amPm":"pm"}},
 *    "aria-describedby":"moana-72474 moana-72474-universal-cinema-an-amc-theatre-opencaption-reclinerseating-laseratamc-reservedseating-0"}
 *
 * The first aria-describedby token is `{slug}-{movieId}` (movie identity); the
 * second token additionally encodes the format/attribute codes for that showtime
 * group — a real IMAX-70mm screening contains `imax70mm` (or a bare `70mm`) there.
 */

const IS_70MM = /imax70mm|(?:^|[-\s])70mm(?:[-\s]|$)/i;

function titleFromSlug(slug: string): string {
  return (
    slug
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim() || "Unknown"
  );
}

/**
 * Decode the __next_f JS-string chunks (raw <script> text, already filtered to
 * those containing __next_f) into a single logical RSC stream string.
 */
export function decodeNextFlight(rawScriptText: string): string {
  const pushes = [
    ...rawScriptText.matchAll(/self\.__next_f\.push\(\[\d+,\s*("(?:[^"\\]|\\.)*")\s*\]\)/g),
  ];
  let stream = "";
  for (const m of pushes) {
    try {
      stream += JSON.parse(m[1]);
    } catch {
      // skip malformed chunk
    }
  }
  return stream || rawScriptText;
}

/**
 * Parse showtimes out of the decoded AMC RSC stream. Returns ALL showtimes with
 * is70mm correctly flagged; the caller decides what to keep/send.
 */
export function parseAmcRsc(stream: string, bookingFallback?: string): NormalizedShowtimeLite[] {
  const out: NormalizedShowtimeLite[] = [];
  const seen = new Set<string>();
  const re =
    /"showtimeId":(\d+)[\s\S]{0,600}?"showDateTimeUtc":"([^"]+)"[\s\S]{0,600}?"aria-describedby":"([^"]+?)"/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(stream)) !== null) {
    const [, id, utc, aria] = m;
    if (seen.has(id)) continue;
    seen.add(id);

    const startsAt = new Date(utc);
    if (Number.isNaN(startsAt.getTime())) continue;

    const firstTok = aria.split(/\s+/)[0] || "";
    const mv = firstTok.match(/^(.+)-(\d+)$/);
    const movieExternalId = mv ? mv[2] : undefined;
    const slug = mv ? mv[1] : firstTok;
    const is70mm = IS_70MM.test(aria);

    out.push({
      externalId: id,
      startsAt: startsAt.toISOString(),
      movieTitle: titleFromSlug(slug),
      movieExternalId,
      format: is70mm ? "IMAX 70mm" : "Standard",
      is70mm,
      bookingUrl: bookingFallback,
    });
  }
  return out;
}
