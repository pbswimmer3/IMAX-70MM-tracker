import type { NormalizedShowtimeLite } from "./types";

export interface Showtime70mmGroup {
  movieTitle: string;
  movieExternalId?: string;
  format: string;
  count: number;
  // Full records for the first 2 showtimes seen in this group, in order.
  samples: NormalizedShowtimeLite[];
}

// Groups a theatre's 70mm showtimes by (movieTitle, movieExternalId, format)
// so a scrape run can be diagnosed: is a single movie/format showing up
// under an unexpected key, or is the movieTitle/movieExternalId blank on
// some subset of records? Groups are sorted by count descending. An
// undefined movieExternalId is grouped separately from an empty-string one.
export function summarize70mm(showtimes: NormalizedShowtimeLite[]): Showtime70mmGroup[] {
  const groups = new Map<string, Showtime70mmGroup>();
  for (const s of showtimes) {
    if (!s.is70mm) continue;
    const key = `${s.movieTitle}|${s.movieExternalId ?? "-"}|${s.format}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        movieTitle: s.movieTitle,
        movieExternalId: s.movieExternalId,
        format: s.format,
        count: 0,
        samples: [],
      };
      groups.set(key, group);
    }
    group.count++;
    if (group.samples.length < 2) group.samples.push(s);
  }
  return Array.from(groups.values()).sort((a, b) => b.count - a.count);
}
