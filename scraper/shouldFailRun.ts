export interface ShouldFailRunInput {
  posted70mm: number;
  showtimesUpserted: number;
  errors: string[];
  dryRun: boolean;
}

// A red workflow run is the alarm for a broken ingest pipeline (e.g. theatres
// not resolvable in the DB): fail when we posted real 70mm showtimes but
// ingest reported nothing landed, or when ingest reported any errors at all.
// Dry runs and legitimately-zero-scrape runs must never fail.
export function shouldFailRun(input: ShouldFailRunInput): boolean {
  if (input.dryRun) return false;
  if (input.errors.length > 0) return true;
  if (input.posted70mm > 0 && input.showtimesUpserted === 0) return true;
  return false;
}
