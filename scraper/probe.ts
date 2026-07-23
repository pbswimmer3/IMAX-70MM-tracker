import type { RawAmcRecord } from "./parseAmc";
import { addDaysYmd } from "./theatres";

export interface ProbeOptions {
  today: string; // YYYY-MM-DD
  storedHorizon: string | null; // YYYY-MM-DD or null
  lookback?: number; // default 2
  overshoot?: number; // default 1
  maxForward?: number; // default 60
}

export interface ProbeResult {
  records: RawAmcRecord[]; // all raw records across probed dates (each tagged with queryDate)
  observedHorizon: string | null; // last date with >=1 showtime, else null
  datesWithShowtimes: number;
  datesProbed: string[];
}

// fetchDate(ymd) returns ALL showtime records on that local date (any format); [] = empty date.
export async function probeHorizon(
  fetchDate: (ymd: string) => Promise<RawAmcRecord[]>,
  opts: ProbeOptions
): Promise<ProbeResult> {
  const lookback = opts.lookback ?? 2;
  const overshoot = opts.overshoot ?? 1;
  const maxForward = opts.maxForward ?? 60;

  const lookbackStart = opts.storedHorizon ? addDaysYmd(opts.storedHorizon, -lookback) : opts.today;
  const start = opts.today > lookbackStart ? opts.today : lookbackStart;

  const records: RawAmcRecord[] = [];
  const datesProbed: string[] = [];
  let observedHorizon: string | null = null;
  let datesWithShowtimes = 0;
  let emptyStreak = 0;

  let ymd = start;
  for (let i = 0; i < maxForward; i++) {
    const recs = await fetchDate(ymd);
    for (const rec of recs) {
      rec.queryDate = ymd;
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

  return { records, observedHorizon, datesWithShowtimes, datesProbed };
}
