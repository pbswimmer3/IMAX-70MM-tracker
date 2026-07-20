export interface TheatreSeed {
  chain: "AMC" | "REGAL";
  name: string;
  city: string;
  externalId: string;
  priority: number;
}

// Seed source of truth for the theatres this tracker watches.
// Regal externalIds are the numeric cinema ids from regmovies.com URLs
// (the same value used by getShowtimes?theatres={id}) — verified.
// AMC externalIds are the numeric theatreIds required by api.amctheatres.com.
// AMC does not expose these publicly (its URLs use name slugs), so they stay
// as placeholders until resolved with your vendor key: run `npm run resolve:amc`
// and paste the printed ids in below. Adapters fail gracefully until then.
export const THEATRES: TheatreSeed[] = [
  {
    chain: "AMC",
    name: "AMC Metreon 16 & IMAX",
    city: "San Francisco, CA",
    externalId: "AMC_METREON_TODO", // TODO: run `npm run resolve:amc`
    priority: 1,
  },
  {
    chain: "REGAL",
    name: "Regal Hacienda Crossings & IMAX",
    city: "Dublin, CA",
    externalId: "0347",
    priority: 2,
  },
  {
    chain: "AMC",
    name: "Universal Cinema AMC at CityWalk Hollywood & IMAX",
    city: "Universal City, CA",
    externalId: "AMC_CITYWALK_TODO", // TODO: run `npm run resolve:amc`
    priority: 3,
  },
  {
    chain: "REGAL",
    name: "Regal Irvine Spectrum & IMAX",
    city: "Irvine, CA",
    externalId: "1010",
    priority: 4,
  },
  {
    chain: "REGAL",
    name: "Regal LA Live & IMAX",
    city: "Los Angeles, CA",
    externalId: "1484",
    priority: 5,
  },
  {
    chain: "REGAL",
    name: "Regal Edwards Ontario Palace & IMAX",
    city: "Ontario, CA",
    externalId: "1026",
    priority: 6,
  },
];
