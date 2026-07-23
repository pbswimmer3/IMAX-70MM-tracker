import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { ingestAndDetect, sendDropDigest } from "@/lib/pipeline";
import { recordHeartbeat } from "@/lib/heartbeat";
import type { NormalizedShowtime } from "@/lib/adapters/types";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

interface RawShowtime {
  externalId?: unknown;
  startsAt?: unknown;
  movieTitle?: unknown;
  movieExternalId?: unknown;
  format?: unknown;
  is70mm?: unknown;
  bookingUrl?: unknown;
  showDate?: unknown;
}

interface RawTheatre {
  externalId?: unknown;
  chain?: unknown;
  showtimes?: unknown;
  observedHorizon?: unknown;
}

interface RawBody {
  runReminders?: unknown;
  theatres?: unknown;
  // Optional heartbeat from an out-of-band source (e.g. the Regal-on-PC
  // scraper): { source: "REGAL_PC", blocked: boolean }.
  sourceHealth?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Validates + normalizes one theatre's showtimes, converting startsAt strings
// to Dates and dropping any entry with a missing/invalid date or missing
// required string fields. Returns null if the theatre entry itself is
// malformed (missing chain/externalId).
function normalizeTheatre(
  raw: RawTheatre
): {
  externalId: string;
  chain: string;
  showtimes: NormalizedShowtime[];
  observedHorizon: string | null;
} | null {
  if (typeof raw.externalId !== "string" || typeof raw.chain !== "string") return null;
  const rawShowtimes = Array.isArray(raw.showtimes) ? (raw.showtimes as RawShowtime[]) : [];

  const showtimes: NormalizedShowtime[] = [];
  for (const s of rawShowtimes) {
    if (!isObject(s)) continue;
    if (typeof s.externalId !== "string") continue;
    if (typeof s.startsAt !== "string") continue;
    if (typeof s.movieTitle !== "string") continue;
    if (typeof s.format !== "string") continue;
    if (typeof s.is70mm !== "boolean") continue;

    const startsAt = new Date(s.startsAt);
    if (Number.isNaN(startsAt.getTime())) continue;

    showtimes.push({
      externalId: s.externalId,
      startsAt,
      movieTitle: s.movieTitle,
      movieExternalId: typeof s.movieExternalId === "string" ? s.movieExternalId : undefined,
      format: s.format,
      is70mm: s.is70mm,
      bookingUrl: typeof s.bookingUrl === "string" ? s.bookingUrl : undefined,
      showDate: typeof s.showDate === "string" ? s.showDate : undefined,
    });
  }

  return {
    externalId: raw.externalId,
    chain: raw.chain,
    showtimes,
    observedHorizon: typeof raw.observedHorizon === "string" ? raw.observedHorizon : null,
  };
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || !authHeader || !safeEqual(authHeader, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RawBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isObject(body) || !Array.isArray(body.theatres)) {
    return NextResponse.json({ error: "Body must include a theatres array" }, { status: 400 });
  }

  const normalized = (body.theatres as RawTheatre[])
    .map((t) => (isObject(t) ? normalizeTheatre(t) : null))
    .filter((t): t is NonNullable<typeof t> => t !== null);

  if (normalized.length === 0) {
    return NextResponse.json(
      { error: "No valid theatre entries in theatres array" },
      { status: 400 }
    );
  }

  // Record a heartbeat if the source included one (e.g. the Regal-on-PC scraper).
  let heartbeatRecorded = false;
  if (isObject(body.sourceHealth)) {
    const sh = body.sourceHealth as Record<string, unknown>;
    if (typeof sh.source === "string" && sh.source.length > 0) {
      await recordHeartbeat(sh.source, sh.blocked === true);
      heartbeatRecorded = true;
    }
  }

  const { showtimesUpserted, newDropEventIds, errors: ingestErrors } = await ingestAndDetect(
    normalized
  );
  const { digestsSent, errors: digestErrors } = await sendDropDigest();

  return NextResponse.json({
    theatresIngested: normalized.length,
    showtimesUpserted,
    newDrops: newDropEventIds.length,
    digestsSent,
    heartbeatRecorded,
    errors: [...ingestErrors, ...digestErrors],
  });
}
