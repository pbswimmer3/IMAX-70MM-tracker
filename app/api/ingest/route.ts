import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { ingestAndDetect, sendDropEmails, processReminderPass } from "@/lib/pipeline";
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
}

interface RawTheatre {
  externalId?: unknown;
  chain?: unknown;
  showtimes?: unknown;
}

interface RawBody {
  runReminders?: unknown;
  theatres?: unknown;
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
): { externalId: string; chain: string; showtimes: NormalizedShowtime[] } | null {
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
    });
  }

  return { externalId: raw.externalId, chain: raw.chain, showtimes };
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

  const runReminders = body.runReminders !== false;

  const { showtimesUpserted, newDropEventIds, errors: ingestErrors } = await ingestAndDetect(
    normalized
  );
  const { errors: dropEmailErrors } = await sendDropEmails(newDropEventIds);
  const { remindersSent, errors: reminderErrors } = runReminders
    ? await processReminderPass()
    : { remindersSent: 0, errors: [] as string[] };

  return NextResponse.json({
    theatresIngested: normalized.length,
    showtimesUpserted,
    newDrops: newDropEventIds.length,
    remindersSent,
    errors: [...ingestErrors, ...dropEmailErrors, ...reminderErrors],
  });
}
