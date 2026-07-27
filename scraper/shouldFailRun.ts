export interface ShouldFailRunInput {
  // True when the POST to /api/ingest itself failed (non-OK status, network
  // error, or an unparsable response) — see scrape.ts.
  postFailed: boolean;
  // Pipeline errors only (the ingest response's `errors`, NOT `notifyErrors`
  // — an email-send failure must never red the scrape run).
  errors: string[];
  // Count of active Movie rows the ingest run matched against. Absent on an
  // older deployed app version; treated as "unknown" and never fails.
  activeMovies?: number;
  // How many theatres this run posted results for.
  theatresPosted: number;
  // Count of theatres ingest resolved by (chain, externalId). Absent on an
  // older deployed app version; treated as "unknown" and never fails.
  theatresMatched?: number;
  // Total 70mm showtimes in the POST body (sum of t.showtimes.length across
  // body.theatres).
  showtimesPosted: number;
  // How many showtimes the ingest response reported it upserted. Absent on an
  // older deployed app version, or if the response was unparsable; treated as
  // "unknown" and never fails.
  showtimesUpserted?: number;
  dryRun: boolean;
}

// A red workflow run is the alarm for a broken pipeline (app down, DB
// unreachable, theatres/movies missing from the DB) — not a proxy for "no
// 70mm showtimes tonight". The old heuristic (posted70mm > 0 &&
// showtimesUpserted === 0) was movie-agnostic: is70mm comes purely from the
// AMC experience-heading text (no movie involved), while ingest only upserts
// showtimes matching an ACTIVE Movie. So a 70mm repertory title playing, or
// The Odyssey simply ending its run / being deactivated, produced
// posted>0 + upserted=0 + no errors => a false-red every 15 minutes with
// nothing actually broken.
//
// Fail (return true) only when !dryRun AND any of:
//  - the ingest POST itself failed (postFailed)
//  - the ingest response reported pipeline errors
//  - there are zero active movies to match against (nothing CAN match)
//  - theatres were posted but ingest resolved none of them (nothing CAN land)
//  - theatres and movies resolved, showtimes were posted, but zero landed
//    (nothing CAN explain that except a matcher/validation bug — a
//    legitimate no-70mm night posts zero showtimes, so this cannot false-red)
// Dry runs never fail. Fields absent from an older deployed app version
// (activeMovies/theatresMatched/showtimesUpserted) are treated as unknown,
// not failing.
export function shouldFailRun(input: ShouldFailRunInput): boolean {
  if (input.dryRun) return false;
  if (input.postFailed) return true;
  if (input.errors.length > 0) return true;
  if (typeof input.activeMovies === "number" && Number.isFinite(input.activeMovies)) {
    if (input.activeMovies === 0) return true;
  }
  if (
    input.theatresPosted > 0 &&
    typeof input.theatresMatched === "number" &&
    Number.isFinite(input.theatresMatched)
  ) {
    if (input.theatresMatched === 0) return true;
  }
  if (
    typeof input.theatresMatched === "number" &&
    Number.isFinite(input.theatresMatched) &&
    typeof input.activeMovies === "number" &&
    Number.isFinite(input.activeMovies) &&
    typeof input.showtimesUpserted === "number" &&
    Number.isFinite(input.showtimesUpserted)
  ) {
    if (
      input.theatresMatched > 0 &&
      input.activeMovies > 0 &&
      input.showtimesPosted > 0 &&
      input.showtimesUpserted === 0
    ) {
      return true;
    }
  }
  return false;
}
