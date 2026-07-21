import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { checkHeartbeats } from "@/lib/heartbeat";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Watchdog for out-of-band ingestion sources (the Regal-on-PC scraper). Called
// on a schedule (GitHub Actions, every run) — it stays up even when the home PC
// is off, so it can detect the PC going offline. Sends one alert per outage and
// a recovery email when the feed returns. Safe to call frequently: alert dedupe
// lives in SourceHealth.alertState.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || !authHeader || !safeEqual(authHeader, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await checkHeartbeats();
  return NextResponse.json(result);
}
