import type { NormalizedShowtimeLite } from "./types";

/**
 * AMC redesigned their showtimes page (mid-2026): the showtime data no longer
 * lives in the RSC payload as {showtimeId, showDateTimeUtc}. It now renders in
 * the DOM as, per movie:
 *
 *   <section aria-label="Showtimes for The Odyssey" id="the-odyssey-76238">
 *     ...experience groups, each led by a heading "FORMAT: ALL-CAPS TAGLINE"...
 *       "IMAX 70MM: EXTRAORDINARY AWAITS"
 *       <a href="/showtimes/144500192"><time datetime="2026-07-21T13:05:00.000Z">…</time></a>
 *
 * The 70mm signal is the experience-group heading (the anchor className is
 * generic Tailwind and carries no format info). Extraction happens in-page
 * (scrape.ts) and yields RawAmcRecord[]; this module holds the pure Node-side
 * classification + normalization so it stays testable.
 */

export interface RawAmcRecord {
  showtimeId: string;
  datetimeIso: string; // <time datetime="…"> — absolute UTC ISO
  movieExternalId?: string;
  movieTitle: string;
  formatLabel: string; // experience-group heading text before the colon, e.g. "IMAX 70MM"
}

const AMC_BASE = "https://www.amctheatres.com";

// A real IMAX-70mm or bare-70mm engagement. AMC labels them "IMAX 70MM" and
// "70mm"; everything else ("PRIME at AMC", "IMAX at AMC", "Laser at AMC",
// "RealD 3D", "Dolby Cinema at AMC", …) is not 70mm.
export function is70mmFormat(formatLabel: string): boolean {
  return /70\s*mm/i.test(formatLabel);
}

export function normalizeAmcRecords(records: RawAmcRecord[]): NormalizedShowtimeLite[] {
  const seen = new Set<string>();
  const out: NormalizedShowtimeLite[] = [];
  for (const r of records) {
    if (!r.showtimeId || seen.has(r.showtimeId)) continue;
    const startsAt = new Date(r.datetimeIso);
    if (Number.isNaN(startsAt.getTime())) continue;
    seen.add(r.showtimeId);

    const is70 = is70mmFormat(r.formatLabel);
    out.push({
      externalId: r.showtimeId,
      startsAt: startsAt.toISOString(),
      movieTitle: r.movieTitle || "Unknown",
      movieExternalId: r.movieExternalId,
      format: r.formatLabel || (is70 ? "IMAX 70mm" : "Standard"),
      is70mm: is70,
      bookingUrl: `${AMC_BASE}/showtimes/${r.showtimeId}`,
    });
  }
  return out;
}
