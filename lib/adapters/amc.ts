import type { Adapter, NormalizedShowtime, TheatreLike } from "./types";

function formatMdy(date: Date): string {
  // M-D-YYYY, no leading zeros
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month}-${day}-${year}`;
}

function upperIncludes70mm(value: string | undefined | null): boolean {
  if (!value) return false;
  const upper = value.toUpperCase();
  return upper.includes("70MM") || upper.includes("70 MM");
}

interface AmcAttribute {
  code?: string;
  name?: string;
}

interface AmcShowtimeEntry {
  id?: number | string;
  showDateTimeUtc?: string;
  showDateTimeLocal?: string;
  movieName?: string;
  movieId?: number | string;
  purchaseUrl?: string;
  premiumFormat?: string;
  _embedded?: {
    attributes?: AmcAttribute[];
  };
}

interface AmcHalResponse {
  _embedded?: {
    showtimes?: AmcShowtimeEntry[];
  };
  _links?: {
    next?: { href?: string };
  };
}

const MAX_PAGES_PER_DATE = 5;

async function fetchShowtimesForDate(
  externalId: string,
  mdy: string
): Promise<AmcShowtimeEntry[]> {
  const vendorKey = process.env.AMC_VENDOR_KEY;
  if (!vendorKey) {
    console.warn("[amc adapter] AMC_VENDOR_KEY missing; skipping fetch");
    return [];
  }

  const results: AmcShowtimeEntry[] = [];
  let url: string | undefined = `https://api.amctheatres.com/v2/theatres/${externalId}/showtimes/${mdy}`;
  let pages = 0;

  while (url && pages < MAX_PAGES_PER_DATE) {
    try {
      const res: Response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "X-AMC-Vendor-Key": vendorKey,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
      });

      if (!res.ok) {
        console.warn(
          `[amc adapter] non-2xx response (${res.status}) for ${externalId} on ${mdy}`
        );
        break;
      }

      const data = (await res.json()) as AmcHalResponse;
      const showtimes = data._embedded?.showtimes ?? [];
      results.push(...showtimes);

      const next = data._links?.next?.href;
      url = next || undefined;
      pages += 1;
    } catch (err) {
      console.warn(
        `[amc adapter] fetch failed for ${externalId} on ${mdy}:`,
        err instanceof Error ? err.message : err
      );
      break;
    }
  }

  return results;
}

function mapShowtime(entry: AmcShowtimeEntry): NormalizedShowtime | null {
  if (entry.id === undefined || entry.id === null) return null;

  const rawDate = entry.showDateTimeUtc ?? entry.showDateTimeLocal;
  if (!rawDate) return null;
  const startsAt = new Date(rawDate);
  if (Number.isNaN(startsAt.getTime())) return null;

  const attributes = entry._embedded?.attributes ?? [];
  const attributeCodes = attributes.map((a) => a.code).filter(Boolean) as string[];
  const attributeNames = attributes.map((a) => a.name).filter(Boolean) as string[];

  const is70mm =
    attributeCodes.some(upperIncludes70mm) ||
    attributeNames.some(upperIncludes70mm) ||
    upperIncludes70mm(entry.premiumFormat);

  const readableFormat =
    attributeNames.length > 0
      ? attributeNames.join(", ")
      : entry.premiumFormat || "Standard";

  return {
    externalId: String(entry.id),
    startsAt,
    movieTitle: entry.movieName ?? "Unknown",
    movieExternalId:
      entry.movieId !== undefined && entry.movieId !== null
        ? String(entry.movieId)
        : undefined,
    format: readableFormat,
    is70mm,
    bookingUrl: entry.purchaseUrl,
  };
}

export const amcAdapter: Adapter = {
  async fetchShowtimes(theatre: TheatreLike, days: number): Promise<NormalizedShowtime[]> {
    const results: NormalizedShowtime[] = [];
    const today = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const mdy = formatMdy(date);

      const entries = await fetchShowtimesForDate(theatre.externalId, mdy);
      for (const entry of entries) {
        const mapped = mapShowtime(entry);
        if (mapped) results.push(mapped);
      }
    }

    return results;
  },
};

export default amcAdapter;
