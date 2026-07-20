import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.title !== "string" || typeof body.slug !== "string") {
    return NextResponse.json({ error: "title and slug are required" }, { status: 400 });
  }

  try {
    const movie = await prisma.movie.create({
      data: {
        title: body.title,
        slug: body.slug,
        matchers: body.matchers ?? {},
        active: true,
      },
    });
    return NextResponse.json({ movie });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create movie" },
      { status: 400 }
    );
  }
}
