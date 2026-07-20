import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verify } from "@/lib/token";

function htmlPage(message: string): string {
  return `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /><title>Unsubscribed</title></head>
  <body style="margin:0;padding:0;background-color:#0A0A0C;font-family:Arial,Helvetica,sans-serif;color:#ECE3CF;">
    <div style="max-width:480px;margin:80px auto;padding:32px;background-color:#141317;border:1px solid #2A2822;border-radius:8px;text-align:center;">
      <p style="font-family:'Courier New',Courier,monospace;font-size:12px;letter-spacing:2px;color:#F0A63C;text-transform:uppercase;margin:0 0 12px 0;">Tracker updated</p>
      <p style="font-size:16px;margin:0;">${message}</p>
    </div>
  </body>
</html>`;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const payload = token ? verify(token) : null;

  if (!payload) {
    return new NextResponse(htmlPage("This link is invalid or has expired."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const { userId, dropEventId } = payload;

  const dropEvent = await prisma.dropEvent.findUnique({
    where: { id: dropEventId },
    include: { movie: true },
  });

  if (!dropEvent) {
    return new NextResponse(htmlPage("This link is invalid or has expired."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  await prisma.reminder.updateMany({
    where: { userId, dropEventId },
    data: { dismissed: true },
  });

  await prisma.subscription.updateMany({
    where: { userId, movieId: dropEvent.movieId },
    data: { active: false },
  });

  return new NextResponse(
    htmlPage(`You're no longer tracking ${dropEvent.movie.title}.`),
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
