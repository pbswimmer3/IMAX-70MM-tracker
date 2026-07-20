import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { SubscriptionToggle } from "./SubscriptionToggle";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/");
  }

  const userId = session.user.id;

  const [theatres, movies, subscriptions, showtimes] = await Promise.all([
    prisma.theatre.findMany({ orderBy: { priority: "asc" } }),
    prisma.movie.findMany({ where: { active: true }, orderBy: { title: "asc" } }),
    prisma.subscription.findMany({ where: { userId, active: true } }),
    prisma.showtime.findMany({
      where: { startsAt: { gte: new Date() } },
      include: { movie: true, theatre: true },
      orderBy: { startsAt: "asc" },
    }),
  ]);

  const subscribedMovieIds = new Set(
    subscriptions.filter((s) => s.theatreId === null).map((s) => s.movieId)
  );

  const showtimesByTheatre = new Map<string, typeof showtimes>();
  for (const showtime of showtimes) {
    const list = showtimesByTheatre.get(showtime.theatreId) ?? [];
    list.push(showtime);
    showtimesByTheatre.set(showtime.theatreId, list);
  }

  return (
    <div className="container">
      <p className="eyebrow">Dashboard</p>
      <h1>Your tracker</h1>

      <div className="panel">
        <h2>Movies</h2>
        <p>Toggle a movie to get emailed the moment 70mm shows drop at any of the six theatres.</p>
        {movies.map((movie) => (
          <div key={movie.id} className="theatre-row">
            <span>{movie.title}</span>
            <SubscriptionToggle
              movieId={movie.id}
              initialActive={subscribedMovieIds.has(movie.id)}
            />
          </div>
        ))}
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

      <div className="panel">
        <h2>Upcoming 70mm showtimes</h2>
        {theatres.map((theatre) => {
          const theatreShowtimes = showtimesByTheatre.get(theatre.id);
          if (!theatreShowtimes || theatreShowtimes.length === 0) return null;
          return (
            <div key={theatre.id} style={{ marginBottom: 20 }}>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--muted)" }}>
                {theatre.name}
              </p>
              <table className="mono">
                <tbody>
                  {theatreShowtimes.map((showtime) => (
                    <tr key={showtime.id}>
                      <td>{showtime.movie.title}</td>
                      <td>
                        {new Date(showtime.startsAt).toLocaleString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </td>
                      <td>{showtime.format}</td>
                      <td>
                        {showtime.bookingUrl ? (
                          <a href={showtime.bookingUrl}>tickets &rarr;</a>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
        {showtimes.length === 0 && <p>No upcoming 70mm showtimes detected yet.</p>}
      </div>
    </div>
  );
}
