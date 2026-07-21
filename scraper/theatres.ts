import type { ScrapeTheatre } from "./types";

// Self-contained copy of the app's theatre seed list so the scraper can run a
// dry run without hitting /api/scrape-config. Keep in sync with
// lib/theatres.ts.
export const THEATRES: ScrapeTheatre[] = [
  {
    chain: "AMC",
    externalId: "AMC_METREON_TODO",
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
    externalId: "AMC_CITYWALK_TODO",
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

function formatYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Builds the next N (default 14) YYYY-MM-DD dates starting today, used to
// drive in-page Regal getShowtimes fetches (one call per date).
export function regalDateRange(days = 14): string[] {
  const dates: string[] = [];
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(formatYmd(d));
  }
  return dates;
}

// Builds the in-page relative fetch URL for one date (used via page.evaluate,
// same-origin so it carries the Cloudflare clearance cookie).
export function regalGetShowtimesPath(externalId: string, ymd: string): string {
  return `/api/getShowtimes?theatres=${encodeURIComponent(
    externalId
  )}&date=${ymd}&hoCode=&ignoreCache=false&moviesOnly=false`;
}
