"use client";

import { useEffect } from "react";

// global-error.tsx replaces the root layout when an error is thrown in the
// layout itself, so it must render its own <html>/<body> and cannot rely on
// globals.css being applied. Styles are inlined to match the app's dark theme.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          background: "#0a0a0c",
          color: "#ece3cf",
          fontFamily: "system-ui, -apple-system, sans-serif",
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ maxWidth: 460, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, marginBottom: 12 }}>
            Something went wrong.
          </h1>
          <p style={{ color: "#b9af95", lineHeight: 1.5, marginBottom: 20 }}>
            The app hit an unexpected error. Try again in a moment.
          </p>
          {error.digest ? (
            <p style={{ color: "#7a7263", fontSize: 13, marginBottom: 20 }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              background: "#f0a63c",
              color: "#0a0a0c",
              border: "none",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
