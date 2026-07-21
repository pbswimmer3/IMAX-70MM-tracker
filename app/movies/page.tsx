import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AddMovieForm } from "./AddMovieForm";

export default async function MoviesPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/");
  }

  const movies = await prisma.movie.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div className="container">
      <p className="eyebrow">Movies</p>
      <h1>Add a movie to track</h1>
      <p>
        Add any 70mm release by title and a matchers JSON blob describing how
        to recognize it in the AMC and Regal feeds.
      </p>

      <div className="panel">
        <AddMovieForm />
      </div>

      <div className="panel">
        <h2>Existing movies</h2>
        {movies.length === 0 ? (
          <p className="search-hint" style={{ padding: 0 }}>
            No movies tracked yet. Search for one above, or run{" "}
            <code>npm run db:seed</code> to load the defaults.
          </p>
        ) : (
          movies.map((movie) => (
            <div key={movie.id} className="theatre-row">
              <span>
                {movie.title} <code style={{ color: "var(--muted)" }}>{movie.slug}</code>
              </span>
              <span className="badge">{movie.active ? "active" : "inactive"}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
