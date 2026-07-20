"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const DEFAULT_MATCHERS = `{
  "amc": { "attributeCodes": ["IMAX70MM", "70MM"], "titlePattern": "" },
  "regal": { "hoCodes": [], "titlePattern": "" }
}`;

export function AddMovieForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [matchers, setMatchers] = useState(DEFAULT_MATCHERS);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    let parsedMatchers: unknown;
    try {
      parsedMatchers = JSON.parse(matchers);
    } catch {
      setError("Matchers must be valid JSON");
      setSubmitting(false);
      return;
    }

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
    setMatchers(DEFAULT_MATCHERS);
    router.refresh();
  }

  return (
    <form className="simple" onSubmit={handleSubmit}>
      <label htmlFor="title">Title</label>
      <input
        id="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />

      <label htmlFor="slug">Slug</label>
      <input
        id="slug"
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        required
      />

      <label htmlFor="matchers">Matchers (JSON)</label>
      <textarea
        id="matchers"
        rows={6}
        value={matchers}
        onChange={(e) => setMatchers(e.target.value)}
      />

      {error && (
        <p style={{ color: "var(--safelight)", fontSize: 13 }}>{error}</p>
      )}

      <button className="btn" type="submit" disabled={submitting} style={{ marginTop: 16 }}>
        {submitting ? "Adding..." : "Add movie"}
      </button>
    </form>
  );
}
