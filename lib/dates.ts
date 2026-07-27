// Every tracked theatre is in California (see lib/theatres.ts), and Showtime
// .startsAt is stored as a UTC instant. Any wall-clock rendering must pin the
// zone explicitly — otherwise the runtime's own zone leaks in (UTC on Vercel,
// which pushed every showtime 7-8h ahead of the real screening time).
export const THEATRE_TIME_ZONE = "America/Los_Angeles";

// Wall-clock label for a showtime instant, in the theatre's local zone.
export function formatShowtime(
  startsAt: Date | string,
  opts: { withZone?: boolean } = {}
): string {
  return new Date(startsAt).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: THEATRE_TIME_ZONE,
    ...(opts.withZone ? { timeZoneName: "short" as const } : {}),
  });
}

// Calendar-day label for an instant, in the theatre's local zone. Uses the
// theatre zone (not UTC) so a 7pm PT show doesn't render as the next day.
export function formatTheatreDay(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: THEATRE_TIME_ZONE,
  });
}

// UTC calendar-date key YYYY-MM-DD for a Date.
export function utcDateKey(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Given the set of already-known drop date-keys and the incoming date-keys,
// return the incoming keys that are new (not in existing), de-duped, sorted asc.
export function newDropDates(existing: Set<string>, incoming: string[]): string[] {
  const fresh = new Set<string>();
  for (const key of incoming) {
    if (!existing.has(key)) fresh.add(key);
  }
  return Array.from(fresh).sort();
}
