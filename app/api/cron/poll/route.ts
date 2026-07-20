import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { getAdapter } from "@/lib/adapters";
import { matchesMovie } from "@/lib/match";
import { sendDropEmail, sendReminderEmail, type ShowtimeLink } from "@/lib/email";
import { sign } from "@/lib/token";

const ONE_HOUR_MS = 60 * 60 * 1000;
const DAYS_AHEAD = 14;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function formatShowtimeLabel(startsAt: Date): string {
  return startsAt.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function loadShowtimeLinks(movieId: string, theatreId: string): Promise<ShowtimeLink[]> {
  const showtimes = await prisma.showtime.findMany({
    where: { movieId, theatreId },
    orderBy: { startsAt: "asc" },
  });
  return showtimes.map((s) => ({
    label: `${formatShowtimeLabel(s.startsAt)} — ${s.format}`,
    url: s.bookingUrl ?? undefined,
  }));
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || !authHeader || !safeEqual(authHeader, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appUrl = process.env.APP_URL ?? "";
  const errors: string[] = [];
  let showtimesUpserted = 0;
  let theatresPolled = 0;

  const [movies, theatres] = await Promise.all([
    prisma.movie.findMany({ where: { active: true } }),
    prisma.theatre.findMany(),
  ]);

  // key: `${movieId}:${theatreId}` -> pair, for any movie that had >=1 matching
  // showtime recorded across this poll run.
  const matchedPairs = new Map<string, { movieId: string; theatreId: string }>();

  for (const theatre of theatres) {
    theatresPolled++;
    try {
      const adapter = getAdapter(theatre.chain);
      const showtimes = await adapter.fetchShowtimes(
        { chain: theatre.chain, externalId: theatre.externalId, name: theatre.name },
        DAYS_AHEAD
      );

      for (const showtime of showtimes) {
        for (const movie of movies) {
          if (!matchesMovie(showtime, movie, theatre.chain)) continue;

          try {
            await prisma.showtime.upsert({
              where: {
                theatreId_externalId: {
                  theatreId: theatre.id,
                  externalId: showtime.externalId,
                },
              },
              update: {
                startsAt: showtime.startsAt,
                format: showtime.format,
                bookingUrl: showtime.bookingUrl,
                movieId: movie.id,
                chain: theatre.chain,
              },
              create: {
                movieId: movie.id,
                theatreId: theatre.id,
                chain: theatre.chain,
                externalId: showtime.externalId,
                startsAt: showtime.startsAt,
                format: showtime.format,
                bookingUrl: showtime.bookingUrl,
              },
            });
            showtimesUpserted++;
            matchedPairs.set(`${movie.id}:${theatre.id}`, {
              movieId: movie.id,
              theatreId: theatre.id,
            });
          } catch (err) {
            errors.push(
              `showtime upsert failed (${theatre.name}, ${movie.title}): ${
                err instanceof Error ? err.message : err
              }`
            );
          }
        }
      }
    } catch (err) {
      errors.push(
        `theatre poll failed (${theatre.name}): ${err instanceof Error ? err.message : err}`
      );
    }
  }

  // Determine new DropEvents.
  const newDropEventIds: string[] = [];
  for (const pair of matchedPairs.values()) {
    try {
      const existing = await prisma.dropEvent.findUnique({
        where: { movieId_theatreId: { movieId: pair.movieId, theatreId: pair.theatreId } },
      });
      if (!existing) {
        const created = await prisma.dropEvent.create({ data: pair });
        newDropEventIds.push(created.id);
      }
    } catch (err) {
      errors.push(
        `drop event check/create failed (${pair.movieId}/${pair.theatreId}): ${
          err instanceof Error ? err.message : err
        }`
      );
    }
  }

  let remindersSent = 0;

  // Send initial drop emails to subscribers of each newly detected drop.
  for (const dropEventId of newDropEventIds) {
    try {
      const dropEvent = await prisma.dropEvent.findUnique({
        where: { id: dropEventId },
        include: { movie: true, theatre: true },
      });
      if (!dropEvent) continue;

      const subscriptions = await prisma.subscription.findMany({
        where: {
          movieId: dropEvent.movieId,
          active: true,
          OR: [{ theatreId: null }, { theatreId: dropEvent.theatreId }],
        },
        include: { user: true },
      });

      const seenUserIds = new Set<string>();
      const showtimeLinks = await loadShowtimeLinks(dropEvent.movieId, dropEvent.theatreId);
      const primaryBookingUrl = showtimeLinks.find((s) => s.url)?.url;

      for (const subscription of subscriptions) {
        const user = subscription.user;
        if (!user.email || seenUserIds.has(user.id)) continue;
        seenUserIds.add(user.id);

        try {
          // Record the send intent (sentCount=1) BEFORE sending. If the email
          // then fails, this drop won't be re-sent, and the reminder pass will
          // correctly treat it as awaiting reminder #2 (not a mislabeled #1).
          await prisma.reminder.create({
            data: {
              userId: user.id,
              dropEventId: dropEvent.id,
              sentCount: 1,
              lastSentAt: new Date(),
            },
          });

          const dismissUrl = `${appUrl}/api/dismiss?token=${sign({
            userId: user.id,
            dropEventId: dropEvent.id,
          })}`;

          await sendDropEmail({
            to: user.email,
            movieTitle: dropEvent.movie.title,
            theatreName: dropEvent.theatre.name,
            city: dropEvent.theatre.city,
            showtimes: showtimeLinks,
            dismissUrl,
            bookingUrl: primaryBookingUrl,
          });
          remindersSent++;
        } catch (err) {
          errors.push(
            `drop email failed (user ${user.id}, drop ${dropEvent.id}): ${
              err instanceof Error ? err.message : err
            }`
          );
        }
      }
    } catch (err) {
      errors.push(
        `drop email pass failed (${dropEventId}): ${err instanceof Error ? err.message : err}`
      );
    }
  }

  // Reminder pass: nudge subscribers who haven't dismissed and haven't hit the cap.
  try {
    const oneHourAgo = new Date(Date.now() - ONE_HOUR_MS);
    const pendingReminders = await prisma.reminder.findMany({
      where: {
        dismissed: false,
        sentCount: { lt: 3 },
        OR: [{ lastSentAt: null }, { lastSentAt: { lte: oneHourAgo } }],
      },
      include: {
        user: true,
        dropEvent: { include: { movie: true, theatre: true } },
      },
    });

    for (const reminder of pendingReminders) {
      if (!reminder.user.email) continue;

      try {
        const showtimeLinks = await loadShowtimeLinks(
          reminder.dropEvent.movieId,
          reminder.dropEvent.theatreId
        );
        const primaryBookingUrl = showtimeLinks.find((s) => s.url)?.url;
        const dismissUrl = `${appUrl}/api/dismiss?token=${sign({
          userId: reminder.userId,
          dropEventId: reminder.dropEventId,
        })}`;

        const nextCount = reminder.sentCount + 1;
        // Consume the slot BEFORE sending so a send failure can never let the
        // next run exceed the 3-email cap (we fail toward fewer emails).
        await prisma.reminder.update({
          where: { id: reminder.id },
          data: { sentCount: nextCount, lastSentAt: new Date() },
        });

        await sendReminderEmail({
          to: reminder.user.email,
          movieTitle: reminder.dropEvent.movie.title,
          theatreName: reminder.dropEvent.theatre.name,
          reminderNumber: nextCount,
          showtimes: showtimeLinks,
          dismissUrl,
          bookingUrl: primaryBookingUrl,
        });
        remindersSent++;
      } catch (err) {
        errors.push(
          `reminder email failed (reminder ${reminder.id}): ${
            err instanceof Error ? err.message : err
          }`
        );
      }
    }
  } catch (err) {
    errors.push(`reminder pass failed: ${err instanceof Error ? err.message : err}`);
  }

  return NextResponse.json({
    theatresPolled,
    showtimesUpserted,
    newDrops: newDropEventIds.length,
    remindersSent,
    errors,
  });
}
