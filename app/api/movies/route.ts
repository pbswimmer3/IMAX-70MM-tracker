import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Admins may add global movies. If ADMIN_EMAILS is unset, any signed-in user is
// allowed (single-user convenience) — set ADMIN_EMAILS (comma-separated) to lock
// this down once you open the app to other people.
function isAdmin(email: string | null | undefined): boolean {
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (admins.length === 0) return true;
  return !!email && admins.includes(email.toLowerCase());
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.title !== "string" || typeof body.slug !== "string") {
    return NextResponse.json({ error: "title and slug are required" }, { status: 400 });
  }

  const matchers = body.matchers ?? {};
  if (!isPlainObject(matchers)) {
    return NextResponse.json({ error: "matchers must be a JSON object" }, { status: 400 });
  }

  try {
    const movie = await prisma.movie.create({
      data: {
        title: body.title,
        slug: body.slug,
        matchers: matchers as Prisma.InputJsonObject,
        active: true,
      },
    });
    return NextResponse.json({ movie });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "That movie (slug) is already tracked." },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create movie" },
      { status: 400 }
    );
  }
}
