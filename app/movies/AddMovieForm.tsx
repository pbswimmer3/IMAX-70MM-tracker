"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const DEFAULT_MATCHERS = `{
  "amc": { "movieIds": [], "titlePattern": "" },
  "regal": { "hoCodes": [], "titlePattern": "" }
}`;

// Builds a matcher set prefilled with a lowercased title-derived
// titlePattern, so picking a TMDB search result produces a working matcher
// instead of the inert default template.
function buildPrefilledMatchers(title: string): string {
  const titlePattern = title.trim().toLowerCase();
  return JSON.stringify(
    {
      amc: { movieIds: [], titlePattern },
      regal: { hoCodes: [], titlePattern },
    },
    null,
    2
  );
}

type SearchResult = {
  tmdbId: number;
  title: string;
  year: string;
  slug: string;
  posterPath: string | null;
};

export function AddMovieForm() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [matchers, setMatchers] = useState(DEFAULT_MATCHERS);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedRef = useRef(false);
  // Tracks the last value this form itself put into the matchers textarea
  // (default or auto-prefilled), so selectMovie only overwrites it when the
  // user hasn't hand-edited it away in the meantime.
  const lastAutoMatchersRef = useRef(DEFAULT_MATCHERS);

  // Debounced TMDB search as the user types in the search bar.
  useEffect(() => {
    const q = query.trim();
    if (selectedRef.current) {
      selectedRef.current = false;
      return;
    }
    if (q.length < 2) {
      setResults([]);
      setSearchError(null);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/movies/search?q=${encodeURIComponent(q)}`);
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setSearchError(body.error ?? "Search failed");
          setResults([]);
        } else {
          setSearchError(null);
          setResults(body.results ?? []);
        }
      } catch {
        if (!cancelled) {
          setSearchError("Search failed");
          setResults([]);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  function selectMovie(movie: SearchResult) {
    selectedRef.current = true;
    setTitle(movie.title);
    setSlug(movie.slug);
    setQuery(movie.year ? `${movie.title} (${movie.year})` : movie.title);
    setResults([]);
    setSearchError(null);

    const prefilled = buildPrefilledMatchers(movie.title);
    setMatchers((current) => {
      if (current !== lastAutoMatchersRef.current) return current;
      lastAutoMatchersRef.current = prefilled;
      return prefilled;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim() || !slug.trim()) {
      setError("Search for a movie to import its title and slug first");
      return;
    }

    let parsedMatchers: unknown;
    try {
      parsedMatchers = JSON.parse(matchers);
    } catch {
      setError("Matchers must be valid JSON");
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/movies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, slug, matchers: parsedMatchers }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to add movie");
      return;
    }

    setTitle("");
    setSlug("");
    setQuery("");
    setResults([]);
    setMatchers(DEFAULT_MATCHERS);
    lastAutoMatchersRef.current = DEFAULT_MATCHERS;
    router.refresh();
  }

  return (
    <form className="simple" onSubmit={handleSubmit}>
      <label htmlFor="movie-search">Search for a movie</label>
      <div style={{ position: "relative" }}>
        <input
          id="movie-search"
          autoComplete="off"
          placeholder="Start typing a title…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setTitle("");
            setSlug("");
          }}
        />
        {(results.length > 0 || searching || searchError) && (
          <div className="search-results">
            {searching && <div className="search-hint">Searching…</div>}
            {searchError && <div className="search-hint">{searchError}</div>}
            {results.map((movie) => (
              <button
                key={movie.tmdbId}
                type="button"
                className="search-result"
                onClick={() => selectMovie(movie)}
              >
                <span>{movie.title}</span>
                {movie.year && <span className="badge">{movie.year}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {title && (
        <p className="search-hint" style={{ marginTop: 8 }}>
          Importing <strong>{title}</strong> · slug <code>{slug}</code>
        </p>
      )}

      <label htmlFor="matchers">Matchers (JSON)</label>
      <textarea
        id="matchers"
        rows={6}
        value={matchers}
        onChange={(e) => setMatchers(e.target.value)}
      />
      <p className="search-hint" style={{ marginTop: 4 }}>
        At least one of titlePattern / amc.movieIds / regal.hoCodes must be
        non-empty, or this movie will never match any showtime.
      </p>

      {error && (
        <p style={{ color: "var(--safelight)", fontSize: 13 }}>{error}</p>
      )}

      <button
        className="btn"
        type="submit"
        disabled={submitting || !title}
        style={{ marginTop: 16 }}
      >
        {submitting ? "Adding..." : "Add movie"}
      </button>
    </form>
  );
}
