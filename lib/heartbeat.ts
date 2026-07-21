import { prisma } from "@/lib/prisma";
import { sendAlertEmail, type AlertKind } from "@/lib/email";

// The out-of-band Regal scraper (running on a home PC) posts a heartbeat with
// every ingest. The watchdog (called by GitHub Actions every run) evaluates
// staleness + blocked status and emails one alert per outage, plus a recovery
// email when it clears.

export const REGAL_SOURCE = "REGAL_PC";

function staleMinutes(): number {
  const raw = Number(process.env.HEARTBEAT_STALE_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 45;
}

function alertRecipient(): string | null {
  return (
    process.env.ALERT_EMAIL ||
    process.env.ADMIN_EMAILS?.split(",")[0]?.trim() ||
    process.env.GMAIL_USER ||
    null
  );
}

// Record a heartbeat from a source. `blocked` = the source ran but was blocked
// (e.g. Regal returned a Cloudflare challenge) rather than returning data.
export async function recordHeartbeat(source: string, blocked: boolean): Promise<void> {
  const now = new Date();
  await prisma.sourceHealth.upsert({
    where: { source },
    create: {
      source,
      lastPostAt: now,
      lastOkAt: blocked ? null : now,
      blocked,
    },
    update: {
      lastPostAt: now,
      blocked,
      ...(blocked ? {} : { lastOkAt: now }),
    },
  });
}

type Condition = "ok" | "offline" | "blocked";

function evaluate(row: { lastPostAt: Date; blocked: boolean }): Condition {
  const ageMin = (Date.now() - row.lastPostAt.getTime()) / 60000;
  if (ageMin > staleMinutes()) return "offline";
  if (row.blocked) return "blocked";
  return "ok";
}

// Evaluate every tracked source and send alerts on state transitions:
// ok -> offline/blocked  => alert once (dedup via alertState)
// offline/blocked -> ok  => recovery email
// offline <-> blocked    => alert for the new condition
export async function checkHeartbeats(): Promise<{
  checked: number;
  alertsSent: number;
  states: Record<string, Condition>;
}> {
  const rows = await prisma.sourceHealth.findMany();
  const to = alertRecipient();
  const states: Record<string, Condition> = {};
  let alertsSent = 0;

  for (const row of rows) {
    const condition = evaluate(row);
    states[row.source] = condition;
    const prev = row.alertState as Condition;
    if (condition === prev) continue;

    const detail = `source=${row.source} lastPostAt=${row.lastPostAt.toISOString()} blocked=${row.blocked}`;
    let kind: AlertKind | null = null;
    if (condition === "ok") kind = "recovered";
    else if (condition === "offline") kind = "offline";
    else if (condition === "blocked") kind = "blocked";

    if (kind && to) {
      await sendAlertEmail({ to, kind, detail });
      alertsSent++;
    } else if (kind && !to) {
      console.warn("[heartbeat] alert suppressed: no ALERT_EMAIL/ADMIN_EMAILS/GMAIL_USER set", {
        source: row.source,
        condition,
      });
    }

    await prisma.sourceHealth.update({
      where: { id: row.id },
      data: { alertState: condition },
    });
  }

  return { checked: rows.length, alertsSent, states };
}
