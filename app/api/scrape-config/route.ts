import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Tells the headless-browser scraper which theatres to visit.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || !authHeader || !safeEqual(authHeader, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const theatres = await prisma.theatre.findMany();

  return NextResponse.json({
    theatres: theatres.map((t) => ({
      id: t.id,
      chain: t.chain,
      externalId: t.externalId,
      name: t.name,
      city: t.city,
      showtimesUrl: t.showtimesUrl,
    })),
  });
}
