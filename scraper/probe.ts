import { addDaysYmd } from "./theatres";

export interface ProbeOptions {
  today: string; // YYYY-MM-DD
  storedHorizon: string | null; // YYYY-MM-DD or null
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
  const lookback = opts.lookback ?? 2;
  const overshoot = opts.overshoot ?? 1;
  const maxForward = opts.maxForward ?? 60;
  const tag = opts.tag ?? ((rec: any, ymd: string) => (rec.queryDate = ymd));
  const now = opts.now ?? Date.now;
  const deadlineMs = opts.deadlineMs;
  const startedAt = now();

  const lookbackStart = opts.storedHorizon ? addDaysYmd(opts.storedHorizon, -lookback) : opts.today;
  const start = opts.today > lookbackStart ? opts.today : lookbackStart;

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
    if (emptyStreak > overshoot) break;
    ymd = addDaysYmd(ymd, 1);
  }

  return { records, observedHorizon, datesWithShowtimes, datesProbed, deadlineExceeded };
}
