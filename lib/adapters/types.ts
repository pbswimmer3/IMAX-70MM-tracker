export interface NormalizedShowtime {
  externalId: string;
  startsAt: Date;
  movieTitle: string;
  movieExternalId?: string;
  format: string;
  is70mm: boolean;
  bookingUrl?: string;
  showDate?: string;
}

export interface TheatreLike {
  chain: string;
  externalId: string;
  name: string;
}

export interface Adapter {
  fetchShowtimes(theatre: TheatreLike, days: number): Promise<NormalizedShowtime[]>;
}
