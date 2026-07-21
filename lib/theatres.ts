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
// AMC externalIds are the numeric theatreIds required by api.amctheatres.com.
// AMC does not expose these publicly (its URLs use name slugs), so they stay
// as placeholders until resolved with your vendor key: run `npm run resolve:amc`
// and paste the printed ids in below. Adapters fail gracefully until then.
//
// showtimesUrl points at the theatre's server-rendered /showtimes page, used
// by the headless-browser scraper (direct APIs are dead: AMC 403s, Regal
// getShowtimes is behind Cloudflare even from residential IPs).
export const THEATRES: TheatreSeed[] = [
  {
    chain: "AMC",
    name: "AMC Metreon 16 & IMAX",
    city: "San Francisco, CA",
    externalId: "AMC_METREON_TODO", // TODO: run `npm run resolve:amc`
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
    externalId: "AMC_CITYWALK_TODO", // TODO: run `npm run resolve:amc`
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
