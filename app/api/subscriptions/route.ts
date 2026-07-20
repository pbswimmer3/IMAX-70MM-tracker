import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Note: Subscription's compound unique index (userId, movieId, theatreId)
// includes a nullable theatreId ("null" means "all theatres"). Prisma's
// generated compound-unique `where` input does not accept null for such
// fields, so we look the row up with findFirst instead of upsert/update
// by compound key.

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.movieId !== "string") {
    return NextResponse.json({ error: "movieId is required" }, { status: 400 });
  }

  const theatreId: string | null = typeof body.theatreId === "string" ? body.theatreId : null;
  const userId = session.user.id;
  const movieId = body.movieId;

  const existing = await prisma.subscription.findFirst({
    where: { userId, movieId, theatreId },
  });

  const subscription = existing
    ? await prisma.subscription.update({
        where: { id: existing.id },
        data: { active: true },
      })
    : await prisma.subscription.create({
        data: { userId, movieId, theatreId, active: true },
      });

  return NextResponse.json({ subscription });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.movieId !== "string") {
    return NextResponse.json({ error: "movieId is required" }, { status: 400 });
  }

  const theatreId: string | null = typeof body.theatreId === "string" ? body.theatreId : null;
  const userId = session.user.id;
  const movieId = body.movieId;

  const existing = await prisma.subscription.findFirst({
    where: { userId, movieId, theatreId },
  });

  if (!existing) {
    return NextResponse.json({ ok: true });
  }

  const subscription = await prisma.subscription.update({
    where: { id: existing.id },
    data: { active: false },
  });

  return NextResponse.json({ subscription });
}
