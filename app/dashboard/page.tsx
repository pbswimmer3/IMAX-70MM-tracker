import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { formatTheatreDay } from "@/lib/dates";
import { SubscriptionToggle } from "./SubscriptionToggle";
import { UpcomingShowtimes } from "./UpcomingShowtimes";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/");
  }

  const userId = session.user.id;

  const [theatres, movies, subscriptions, showtimes, latestByMovie] = await Promise.all([
    prisma.theatre.findMany({ orderBy: { priority: "asc" } }),
    prisma.movie.findMany({ where: { active: true }, orderBy: { title: "asc" } }),
    prisma.subscription.findMany({ where: { userId, active: true } }),
    prisma.showtime.findMany({
      where: { startsAt: { gte: new Date() } },
      include: { movie: true, theatre: true },
      orderBy: { startsAt: "asc" },
    }),
    // Furthest-out showtime currently on sale per movie (across all theatres,
    // including past ones so the "on sale through" date reflects the full
    // window the scraper last saw). _max.startsAt = last day tickets exist.
    prisma.showtime.groupBy({
      by: ["movieId"],
      _max: { startsAt: true, firstSeenAt: true },
    }),
  ]);

  const subscribedMovieIds = new Set(
    subscriptions.filter((s) => s.theatreId === null).map((s) => s.movieId)
  );

  // movieId -> { through: last showtime date, seenAt: last time scraper found any }
  const availabilityByMovie = new Map(
    latestByMovie.map((row) => [
      row.movieId,
      { through: row._max.startsAt, seenAt: row._max.firstSeenAt },
    ])
  );

  const dayFmt = (d: Date) => formatTheatreDay(d);

  const upcomingRows = showtimes.map((showtime) => ({
    id: showtime.id,
    theatreId: showtime.theatreId,
    movieTitle: showtime.movie.title,
    startsAt: showtime.startsAt.toISOString(),
    format: showtime.format,
    bookingUrl: showtime.bookingUrl,
  }));

  return (
    <div className="container">
      <p className="eyebrow">Dashboard</p>
      <h1>Your tracker</h1>

      <div className="panel">
        <h2>Movies</h2>
        <p>Toggle a movie to get emailed the moment 70mm shows drop at any of the six theatres.</p>
        {movies.map((movie) => {
          const avail = availabilityByMovie.get(movie.id);
          return (
            <div key={movie.id} className="theatre-row">
              <span>
                {movie.title}
                {avail?.through ? (
                  <span style={{ display: "block", color: "var(--dim)", fontSize: 12, marginTop: 2 }}>
                    70mm on sale through {dayFmt(avail.through)}
                    {avail.seenAt ? ` · last found ${dayFmt(avail.seenAt)}` : ""}
                  </span>
                ) : (
                  <span style={{ display: "block", color: "var(--dim)", fontSize: 12, marginTop: 2 }}>
                    No 70mm showtimes found yet
                  </span>
                )}
              </span>
              <SubscriptionToggle
                movieId={movie.id}
                initialActive={subscribedMovieIds.has(movie.id)}
              />
            </div>
          );
        })}
        <p style={{ marginTop: 16 }}>
          <Link href="/movies">+ Add another movie</Link>
        </p>
      </div>

      <div className="panel">
        <h2>Theatres tracked</h2>
        {theatres.map((theatre) => (
          <div key={theatre.id} className="theatre-row">
            <span>
              {theatre.name} <span className="badge">{theatre.chain}</span>
            </span>
            <span style={{ color: "var(--dim)", fontSize: 13 }}>{theatre.city}</span>
          </div>
        ))}
      </div>

      <UpcomingShowtimes
        theatres={theatres.map((t) => ({ id: t.id, name: t.name }))}
        showtimes={upcomingRows}
      />
    </div>
  );
}
