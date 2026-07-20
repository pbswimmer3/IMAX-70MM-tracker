"use client";

import { useState, useTransition } from "react";

export function SubscriptionToggle({
  movieId,
  initialActive,
}: {
  movieId: string;
  initialActive: boolean;
}) {
  const [active, setActive] = useState(initialActive);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next = !active;
    startTransition(async () => {
      const method = next ? "POST" : "DELETE";
      const res = await fetch("/api/subscriptions", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movieId }),
      });
      if (res.ok) {
        setActive(next);
      }
    });
  }

  return (
    <button
      className={`btn ${active ? "secondary" : ""}`}
      onClick={toggle}
      disabled={isPending}
      type="button"
    >
      {isPending ? "..." : active ? "Tracking (click to stop)" : "Track this movie"}
    </button>
  );
}
