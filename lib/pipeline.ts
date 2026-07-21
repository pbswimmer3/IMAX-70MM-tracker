import { prisma } from "@/lib/prisma";
import { matchesMovie } from "@/lib/match";
import { sendDropEmail, sendReminderEmail, type ShowtimeLink } from "@/lib/email";
import { sign } from "@/lib/token";
import type { NormalizedShowtime } from "@/lib/adapters/types";

const ONE_HOUR_MS = 60 * 60 * 1000;

export interface TheatreIngest {
  externalId: string;
  chain: string;
  showtimes: NormalizedShowtime[];
}

export function formatShowtimeLabel(startsAt: Date): string {
  return startsAt.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export async function loadShowtimeLinks(
  movieId: string,
  theatreId: string
): Promise<ShowtimeLink[]> {
  const showtimes = await prisma.showtime.findMany({
    where: { movieId, theatreId },
    orderBy: { startsAt: "asc" },
  });
  return showtimes.map((s) => ({
    label: `${formatShowtimeLabel(s.startsAt)} — ${s.format}`,
    url: s.bookingUrl ?? undefined,
  }));
}

// Resolves each Theatre by (chain, externalId), upserts matching showtimes,
// and creates DropEvents on first match per (movie, theatre). Returns the ids
// of newly created DropEvents so the caller can send drop emails for them.
export async function ingestAndDetect(
  inputs: TheatreIngest[]
): Promise<{ showtimesUpserted: number; newDropEventIds: string[]; errors: string[] }> {
  const errors: string[] = [];
  let showtimesUpserted = 0;

  const movies = await prisma.movie.findMany({ where: { active: true } });

  // key: `${movieId}:${theatreId}` -> pair, for any movie that had >=1 matching
  // showtime recorded across this ingest run.
  const matchedPairs = new Map<string, { movieId: string; theatreId: string }>();

  for (const input of inputs) {
    let theatre;
    try {
      theatre = await prisma.theatre.findUnique({
        where: { chain_externalId: { chain: input.chain, externalId: input.externalId } },
      });
    } catch (err) {
      errors.push(
        `theatre lookup failed (${input.chain}/${input.externalId}): ${
          err instanceof Error ? err.message : err
        }`
      );
      continue;
    }

    if (!theatre) {
      errors.push(`unknown theatre (${input.chain}/${input.externalId}); skipping`);
      continue;
    }

    for (const showtime of input.showtimes) {
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

  return { showtimesUpserted, newDropEventIds, errors };
}

// Sends the initial drop email to subscribers of each newly detected drop.
export async function sendDropEmails(
  newDropEventIds: string[]
): Promise<{ sent: number; errors: string[] }> {
  const errors: string[] = [];
  let sent = 0;
  const appUrl = process.env.APP_URL ?? "";

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
          sent++;
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

  return { sent, errors };
}

// Nudges subscribers who haven't dismissed and haven't hit the reminder cap.
export async function processReminderPass(): Promise<{
  remindersSent: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let remindersSent = 0;
  const appUrl = process.env.APP_URL ?? "";

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

  return { remindersSent, errors };
}
