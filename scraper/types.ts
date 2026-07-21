export interface NormalizedShowtimeLite {
  externalId: string;
  startsAt: string; // ISO string
  movieTitle: string;
  movieExternalId?: string;
  format: string;
  is70mm: boolean;
  bookingUrl?: string;
}

export interface ScrapeTheatre {
  chain: "AMC" | "REGAL";
  externalId: string;
  name: string;
  showtimesUrl: string;
}
