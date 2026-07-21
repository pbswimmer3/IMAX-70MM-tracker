import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

// Mirrors the admin gate on POST /api/movies so search shares the same access
// scope (and doesn't let non-admins burn the TMDB quota). Blank ADMIN_EMAILS =
// single-user mode: any signed-in user allowed.
function isAdmin(email: string | null | undefined): boolean {
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (admins.length === 0) return true;
  return !!email && admins.includes(email.toLowerCase());
}

// Derive a URL-safe slug from a movie title, e.g. "The Odyssey" -> "the-odyssey".
function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type TmdbMovie = {
  id: number;
  title: string;
  release_date?: string;
  poster_path?: string | null;
};

// Proxies TMDB title search so the browser never sees the API key. Returns a
// trimmed result list the Add-movie search bar can auto-import into title/slug.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Movie search is not configured (set TMDB_API_KEY)." },
      { status: 503 }
    );
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const url = new URL("https://api.themoviedb.org/3/search/movie");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("query", q);
  url.searchParams.set("include_adult", "false");

  let tmdb: Response;
  try {
    tmdb = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Movie search failed" }, { status: 502 });
  }

  if (!tmdb.ok) {
    return NextResponse.json({ error: "Movie search failed" }, { status: 502 });
  }

  const data = (await tmdb.json().catch(() => null)) as { results?: TmdbMovie[] } | null;
  const results = (data?.results ?? []).slice(0, 8).map((m) => {
    const year = m.release_date ? m.release_date.slice(0, 4) : "";
    return {
      tmdbId: m.id,
      title: m.title,
      year,
      slug: slugify(m.title),
      posterPath: m.poster_path ?? null,
    };
  });

  return NextResponse.json({ results });
}
