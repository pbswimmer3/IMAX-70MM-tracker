"use client";

import { useMemo, useState } from "react";
import { formatShowtime, THEATRE_TIME_ZONE } from "@/lib/dates";

export interface UpcomingShowtimeRow {
  id: string;
  theatreId: string;
  movieTitle: string;
  // ISO instant — Date objects don't survive the server->client boundary intact.
  startsAt: string;
  format: string;
  bookingUrl: string | null;
}

export interface UpcomingTheatreRow {
  id: string;
  name: string;
}

type SortOrder = "asc" | "desc";

export function UpcomingShowtimes({
  theatres,
  showtimes,
}: {
  theatres: UpcomingTheatreRow[];
  showtimes: UpcomingShowtimeRow[];
}) {
  const [order, setOrder] = useState<SortOrder>("asc");

  // Theatre grouping stays in priority order regardless of sort; the toggle
  // only flips the date ordering of the showtimes inside each theatre.
  const byTheatre = useMemo(() => {
    const sorted = [...showtimes].sort((a, b) => {
      const delta = Date.parse(a.startsAt) - Date.parse(b.startsAt);
      return order === "asc" ? delta : -delta;
    });
    const map = new Map<string, UpcomingShowtimeRow[]>();
    for (const showtime of sorted) {
      const list = map.get(showtime.theatreId) ?? [];
      list.push(showtime);
      map.set(showtime.theatreId, list);
    }
    return map;
  }, [showtimes, order]);

  const zoneLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: THEATRE_TIME_ZONE,
    timeZoneName: "short",
  })
    .formatToParts(new Date())
    .find((part) => part.type === "timeZoneName")?.value;

  return (
    <div className="panel">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ margin: 0 }}>Upcoming 70mm showtimes</h2>
        {showtimes.length > 0 && (
          <button
            className="btn secondary"
            type="button"
            onClick={() => setOrder(order === "asc" ? "desc" : "asc")}
            aria-label={`Sort by date, currently ${
              order === "asc" ? "soonest first" : "furthest out first"
            }`}
          >
            {order === "asc" ? "Date ↑ soonest first" : "Date ↓ furthest out first"}
          </button>
        )}
      </div>

      {showtimes.length > 0 && (
        <p style={{ fontSize: 12, color: "var(--dim)", marginTop: 8 }}>
          Times shown in theatre local time{zoneLabel ? ` (${zoneLabel})` : ""}.
        </p>
      )}

      {theatres.map((theatre) => {
        const theatreShowtimes = byTheatre.get(theatre.id);
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
                    <td>{showtime.movieTitle}</td>
                    <td>{formatShowtime(showtime.startsAt)}</td>
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
  );
}
