import type { ScrapeTheatre } from "./types";

// Self-contained copy of the app's theatre seed list so the scraper can run a
// dry run without hitting /api/scrape-config. Keep in sync with
// lib/theatres.ts.
export const THEATRES: ScrapeTheatre[] = [
  {
    chain: "AMC",
    externalId: "amc-metreon-16",
    name: "AMC Metreon 16 & IMAX",
    showtimesUrl:
      "https://www.amctheatres.com/movie-theatres/san-francisco/amc-metreon-16/showtimes",
  },
  {
    chain: "REGAL",
    externalId: "0347",
    name: "Regal Hacienda Crossings & IMAX",
    showtimesUrl: "https://www.regmovies.com/theatres/regal-hacienda-crossings-0347",
  },
  {
    chain: "AMC",
    externalId: "amc-citywalk-hollywood",
    name: "Universal Cinema AMC at CityWalk Hollywood & IMAX",
    showtimesUrl:
      "https://www.amctheatres.com/movie-theatres/los-angeles/universal-cinema-amc-at-citywalk-hollywood/showtimes",
  },
  {
    chain: "REGAL",
    externalId: "1010",
    name: "Regal Irvine Spectrum & IMAX",
    showtimesUrl: "https://www.regmovies.com/theatres/regal-edwards-irvine-spectrum-1010",
  },
  {
    chain: "REGAL",
    externalId: "1484",
    name: "Regal LA Live & IMAX",
    showtimesUrl: "https://www.regmovies.com/theatres/regal-la-live-1484",
  },
  {
    chain: "REGAL",
    externalId: "1026",
    name: "Regal Edwards Ontario Palace & IMAX",
    showtimesUrl: "https://www.regmovies.com/theatres/regal-edwards-ontario-palace-1026",
  },
];

// Every tracked theatre is in California (mirrors THEATRE_TIME_ZONE in
// lib/dates.ts). The probe walk must start on the theatre's calendar day, not
// the runner's: the Regal scraper runs on a home PC in PT, where the UTC date
// rolls over at 5 PM local — starting from the UTC day would skip tonight's
// showings for every run after 5 PM.
export const THEATRE_TIME_ZONE = "America/Los_Angeles";

// Adds n (possibly negative) days to a YYYY-MM-DD string, UTC-safe.
export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Calendar date YYYY-MM-DD for an instant in the given IANA zone. en-CA gives
// ISO-ordered output directly, so no part reassembly is needed.
export function ymdInZone(instant: Date, timeZone: string): string {
  return instant.toLocaleDateString("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

// Today as YYYY-MM-DD on the theatres' local calendar (see THEATRE_TIME_ZONE).
export function todayYmd(): string {
  return ymdInZone(new Date(), THEATRE_TIME_ZONE);
}

// Builds the in-page relative fetch URL for one date (used via page.evaluate,
// same-origin so it carries the Cloudflare clearance cookie).
export function regalGetShowtimesPath(externalId: string, ymd: string): string {
  return `/api/getShowtimes?theatres=${encodeURIComponent(
    externalId
  )}&date=${ymd}&hoCode=&ignoreCache=false&moviesOnly=false`;
}
