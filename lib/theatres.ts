export interface TheatreSeed {
  chain: "AMC" | "REGAL";
  name: string;
  city: string;
  externalId: string;
  priority: number;
  showtimesUrl: string;
}

// Seed source of truth for the theatres this tracker watches.
// Regal externalIds are the numeric cinema ids from regmovies.com URLs
// (the same value used by getShowtimes?theatres={id}) — verified.
// AMC externalIds are stable name slugs (AMC's public URLs use slugs, not the
// numeric theatreIds required by api.amctheatres.com, which are gated behind a
// separate vendor grant — see scripts/resolve-amc.ts if that's ever needed).
// These slugs are only used as DB keys, not to fetch anything: scraping is
// DOM-based off showtimesUrl below.
//
// showtimesUrl points at the theatre's server-rendered /showtimes page, used
// by the headless-browser scraper (direct APIs are dead: AMC 403s, Regal
// getShowtimes is behind Cloudflare even from residential IPs).
export const THEATRES: TheatreSeed[] = [
  {
    chain: "AMC",
    name: "AMC Metreon 16 & IMAX",
    city: "San Francisco, CA",
    externalId: "amc-metreon-16",
    priority: 1,
    showtimesUrl:
      "https://www.amctheatres.com/movie-theatres/san-francisco/amc-metreon-16/showtimes",
  },
  {
    chain: "REGAL",
    name: "Regal Hacienda Crossings & IMAX",
    city: "Dublin, CA",
    externalId: "0347",
    priority: 2,
    showtimesUrl: "https://www.regmovies.com/theatres/regal-hacienda-crossings-0347",
  },
  {
    chain: "AMC",
    name: "Universal Cinema AMC at CityWalk Hollywood & IMAX",
    city: "Universal City, CA",
    externalId: "amc-citywalk-hollywood",
    priority: 3,
    showtimesUrl:
      "https://www.amctheatres.com/movie-theatres/los-angeles/universal-cinema-amc-at-citywalk-hollywood/showtimes",
  },
  {
    chain: "REGAL",
    name: "Regal Irvine Spectrum & IMAX",
    city: "Irvine, CA",
    externalId: "1010",
    priority: 4,
    showtimesUrl: "https://www.regmovies.com/theatres/regal-edwards-irvine-spectrum-1010",
  },
  {
    chain: "REGAL",
    name: "Regal LA Live & IMAX",
    city: "Los Angeles, CA",
    externalId: "1484",
    priority: 5,
    showtimesUrl: "https://www.regmovies.com/theatres/regal-la-live-1484",
  },
  {
    chain: "REGAL",
    name: "Regal Edwards Ontario Palace & IMAX",
    city: "Ontario, CA",
    externalId: "1026",
    priority: 6,
    showtimesUrl: "https://www.regmovies.com/theatres/regal-edwards-ontario-palace-1026",
  },
];

export interface MovieSeed {
  title: string;
  slug: string;
  active: boolean;
  matchers: {
    amc: { movieIds: string[]; attributeCodes: string[]; titlePattern: string };
    regal: { hoCodes: string[]; titlePattern: string };
  };
}

// Seed source of truth for "The Odyssey" — shared by prisma/seed.ts (explicit
// local seeding) and lib/bootstrap.ts (self-healing seed on a prod DB missing
// this row) so the two can never drift.
export const ODYSSEY_MOVIE: MovieSeed = {
  title: "The Odyssey",
  slug: "the-odyssey",
  active: true,
  matchers: {
    amc: {
      movieIds: ["76238", "80679"],
      attributeCodes: ["IMAX70MM", "70MM", "IMAXWITH70MM"],
      titlePattern: "odyssey",
    },
    regal: {
      // Confirmed live 2026-07-28: Regal returns MasterMovieCode HO00019072 for
      // the 70mm presentation at all 4 theatres. Compared case-insensitively.
      // lib/match.ts's id branch is a bare id hit with no title cross-check, so
      // an unconfirmed code here would misattribute another film's 70mm shows.
      // ho00019076/ho00021807 were unverified guesses (see old PROGRESS.md) —
      // only re-add them if confirmed against a real payload.
      hoCodes: ["ho00019072"],
      titlePattern: "odyssey",
    },
  },
};
