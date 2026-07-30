import { addDaysYmd } from "./theatres";

export interface ProbeOptions {
  today: string; // YYYY-MM-DD
  // A MINIMUM END for the walk, not a start hint: the walk always rescans
  // the whole window starting at `today` (showtimes are routinely added to
  // dates already on sale, not just appended at the far edge of the
  // booking window). Until the walk passes this date, the empty-streak
  // termination below is suppressed so a mid-window dark stretch longer
  // than `overshoot` cannot truncate the horizon short of what was already
  // known. null (e.g. FULL_SCAN) means no minimum: ordinary overshoot
  // semantics apply from the very first date.
  storedHorizon: string | null; // YYYY-MM-DD or null
  // Unused now that the walk always starts at `today`; kept for API
  // compatibility with existing callers/tests. No-op.
  lookback?: number; // default 2
  overshoot?: number; // default 1
  maxForward?: number; // default 60
  // Stamps the probed date onto each record. Defaults to `rec.queryDate = ymd`
  // (what AMC's RawAmcRecord uses); Regal records carry it as `showDate`.
  tag?: (rec: any, ymd: string) => void;
  // Overall wall-clock budget (ms) for the whole walk. If exceeded, the walk
  // stops early and ProbeResult.deadlineExceeded is set so the caller can
  // refuse to persist a possibly-truncated observedHorizon. Undefined (the
  // default) means no deadline is enforced.
  deadlineMs?: number;
  // Clock source, overridable for tests. Defaults to Date.now.
  now?: () => number;
}

export interface ProbeResult<T> {
  records: T[]; // all raw records across probed dates (each tagged with the probed date)
  observedHorizon: string | null; // last date with >=1 showtime, else null
  datesWithShowtimes: number;
  datesProbed: string[];
  // True if the walk stopped early because it exceeded opts.deadlineMs,
  // rather than because it reached maxForward or its overshoot limit.
  deadlineExceeded: boolean;
}

// fetchDate(ymd) returns ALL showtime records on that local date (any format); [] = empty date.
export async function probeHorizon<T>(
  fetchDate: (ymd: string) => Promise<T[]>,
  opts: ProbeOptions
): Promise<ProbeResult<T>> {
  const overshoot = opts.overshoot ?? 1;
  const maxForward = opts.maxForward ?? 60;
  const tag = opts.tag ?? ((rec: any, ymd: string) => (rec.queryDate = ymd));
  const now = opts.now ?? Date.now;
  const deadlineMs = opts.deadlineMs;
  const startedAt = now();

  // Always rescan from today — see the storedHorizon/minEnd doc comment above.
  const start = opts.today;
  const minEnd = opts.storedHorizon;

  const records: T[] = [];
  const datesProbed: string[] = [];
  let observedHorizon: string | null = null;
  let datesWithShowtimes = 0;
  let emptyStreak = 0;
  let deadlineExceeded = false;

  let ymd = start;
  for (let i = 0; i < maxForward; i++) {
    if (deadlineMs !== undefined && now() - startedAt > deadlineMs) {
      deadlineExceeded = true;
      break;
    }
    const recs = await fetchDate(ymd);
    for (const rec of recs) {
      tag(rec, ymd);
    }
    if (recs.length > 0) {
      records.push(...recs);
      datesWithShowtimes++;
      observedHorizon = ymd;
      emptyStreak = 0;
    } else {
      emptyStreak++;
    }
    datesProbed.push(ymd);
    // Before minEnd, a long dark stretch must not truncate the horizon: it
    // may just be a gap between engagements ahead of previously-known
    // showtimes. Past minEnd, ordinary overshoot semantics apply — this is
    // how the walk still discovers a NEW far-edge horizon.
    const pastMinEnd = minEnd === null || ymd >= minEnd;
    if (pastMinEnd && emptyStreak > overshoot) break;
    ymd = addDaysYmd(ymd, 1);
  }

  return { records, observedHorizon, datesWithShowtimes, datesProbed, deadlineExceeded };
}
