"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the real error (and its digest) in the browser/server console
    // so a production crash is diagnosable instead of silent.
    console.error(error);
  }, [error]);

  return (
    <div className="container">
      <p className="eyebrow">Something went wrong</p>
      <h1>We hit an unexpected error.</h1>
      <div className="panel">
        <p style={{ marginBottom: 16 }}>
          The page failed to load. This is usually temporary &mdash; try again.
          If it keeps happening, the problem is on our end and we&apos;re on it.
        </p>
        {error.digest ? (
          <p style={{ color: "var(--dim)", fontSize: 13, marginBottom: 16 }}>
            Reference: {error.digest}
          </p>
        ) : null}
        <button className="btn" type="button" onClick={() => reset()}>
          Try again
        </button>
      </div>
    </div>
  );
}
