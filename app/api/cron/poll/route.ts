import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { processReminderPass } from "@/lib/pipeline";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Direct theatre APIs are dead (AMC 403s "Unauthorized VendorKey"; Regal's
// getShowtimes is behind Cloudflare even from residential IPs). Ingestion now
// happens out-of-band via the headless-browser scraper posting to
// /api/ingest. This route only runs the reminder pass (nudging subscribers
// who haven't dismissed and haven't hit the send cap).
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || !authHeader || !safeEqual(authHeader, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { remindersSent, errors } = await processReminderPass();

  return NextResponse.json({ remindersSent, errors });
}
