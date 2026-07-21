import nodemailer from "nodemailer";

// Gmail SMTP: set GMAIL_USER to your address and GMAIL_APP_PASSWORD to a
// 16-char Google App Password (Account -> Security -> 2-Step Verification ->
// App passwords). Free Gmail allows ~500 recipients/day — plenty for now.
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

const transporter =
  GMAIL_USER && GMAIL_APP_PASSWORD
    ? nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
      })
    : null;

// Gmail rewrites the envelope sender to the authenticated account, so the
// address here must be GMAIL_USER; only the display name is free-form.
const FROM =
  process.env.EMAIL_FROM ??
  (GMAIL_USER ? `IMAX 70mm Tracker <${GMAIL_USER}>` : "IMAX 70mm Tracker <alerts@example.com>");

export interface ShowtimeLink {
  label: string;
  url?: string;
}

export interface DropEmailParams {
  to: string;
  movieTitle: string;
  theatreName: string;
  city: string;
  showtimes: ShowtimeLink[];
  dismissUrl: string;
  bookingUrl?: string;
}

export interface ReminderEmailParams {
  to: string;
  movieTitle: string;
  theatreName: string;
  reminderNumber: number;
  showtimes: ShowtimeLink[];
  dismissUrl: string;
  bookingUrl?: string;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showtimeRows(showtimes: ShowtimeLink[]): string {
  return showtimes
    .map(
      (s) => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #2A2822;font-family:'Courier New',Courier,monospace;font-size:14px;color:#ECE3CF;">
            ${escapeHtml(s.label)}
          </td>
          <td style="padding:6px 10px;border-bottom:1px solid #2A2822;text-align:right;">
            ${
              s.url
                ? `<a href="${s.url}" style="color:#F0A63C;font-family:'Courier New',Courier,monospace;font-size:13px;text-decoration:none;">tickets &rarr;</a>`
                : ""
            }
          </td>
        </tr>`
    )
    .join("");
}

// "Footage Counter" — dark, celluloid, monospace showtimes table.
export function buildDropEmailHtml(params: Omit<DropEmailParams, "to">): string {
  const { movieTitle, theatreName, city, showtimes, dismissUrl, bookingUrl } = params;

  return `
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#0A0A0C;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0A0A0C;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#141317;border:1px solid #2A2822;border-radius:6px;overflow:hidden;">
            <tr>
              <td style="padding:0;background-color:#0A0A0C;border-bottom:2px dashed #3A382F;">
                <div style="height:14px;background-image:repeating-linear-gradient(90deg,#F0A63C 0 6px,transparent 6px 14px);opacity:0.5;"></div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 28px 8px 28px;">
                <p style="margin:0 0 4px 0;font-family:'Courier New',Courier,monospace;font-size:12px;letter-spacing:2px;color:#F0A63C;text-transform:uppercase;">
                  Print threaded
                </p>
                <h1 style="margin:0 0 6px 0;font-family:Georgia,'Times New Roman',serif;font-size:24px;color:#ECE3CF;">
                  ${escapeHtml(movieTitle)}
                </h1>
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#B9AF95;">
                  ${escapeHtml(theatreName)} &middot; ${escapeHtml(city)}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 28px 4px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                  ${showtimeRows(showtimes)}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px 8px 28px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="background-color:#F0A63C;border-radius:4px;">
                      <a href="${bookingUrl ?? "#"}" style="display:inline-block;padding:12px 22px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#0A0A0C;text-decoration:none;">
                        Get tickets
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 28px 28px;">
                <a href="${dismissUrl}" style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#7A7263;text-decoration:underline;">
                  Don't need to track this movie
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// "Safelight" — minimal, red stripe, single strong CTA.
export function buildReminderEmailHtml(params: Omit<ReminderEmailParams, "to">): string {
  const { movieTitle, theatreName, reminderNumber, showtimes, dismissUrl, bookingUrl } = params;

  return `
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#0A0A0C;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0A0A0C;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#141317;border-radius:6px;overflow:hidden;border-left:4px solid #E24A34;">
            <tr>
              <td style="padding:24px 28px 8px 28px;">
                <p style="margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:1.5px;color:#E24A34;text-transform:uppercase;">
                  Reminder ${reminderNumber} of 3
                </p>
                <h1 style="margin:0 0 6px 0;font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#ECE3CF;">
                  ${escapeHtml(movieTitle)} &mdash; 70mm
                </h1>
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#B9AF95;">
                  ${escapeHtml(theatreName)}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px 4px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                  ${showtimeRows(showtimes)}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px 8px 28px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="background-color:#F0A63C;border-radius:4px;">
                      <a href="${bookingUrl ?? "#"}" style="display:inline-block;padding:14px 26px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#0A0A0C;text-decoration:none;">
                        Get tickets now
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 24px 28px;">
                <a href="${dismissUrl}" style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#7A7263;text-decoration:underline;">
                  Don't need to track this movie
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendDropEmail(params: DropEmailParams): Promise<void> {
  const { to, movieTitle, theatreName } = params;
  const subject = `70mm print threaded — ${movieTitle} · ${theatreName}`;
  const html = buildDropEmailHtml(params);

  if (!transporter) {
    console.warn("[email] GMAIL_USER/GMAIL_APP_PASSWORD missing; skipping sendDropEmail", { to, subject });
    return;
  }

  try {
    await transporter.sendMail({ from: FROM, to, subject, html });
  } catch (err) {
    console.warn("[email] sendDropEmail failed:", err instanceof Error ? err.message : err);
  }
}

export type AlertKind = "offline" | "blocked" | "recovered";

const ALERT_COPY: Record<AlertKind, { subject: string; heading: string; body: string }> = {
  offline: {
    subject: "⚠️ Regal feed down — gaming PC appears offline",
    heading: "The Regal scraper stopped reporting",
    body: "No data has arrived from the Regal scraper on your PC within the staleness window. The PC is likely powered off, asleep, or has lost its network connection. Turn it back on to resume Regal monitoring. (AMC keeps running on GitHub Actions and is unaffected.)",
  },
  blocked: {
    subject: "⚠️ Regal is blocking the scraper (Cloudflare)",
    heading: "Your PC is online, but Regal is blocking it",
    body: "The Regal scraper on your PC is running and reporting in, but Regal returned a Cloudflare challenge instead of showtimes. This usually means Regal changed something or your home IP got flagged. The PC itself is fine — this needs a look at the Regal scraping side.",
  },
  recovered: {
    subject: "✅ Regal feed recovered",
    heading: "Regal monitoring is back to normal",
    body: "The Regal scraper is reporting real showtime data again. No further action needed.",
  },
};

// Dead-man's-switch / heartbeat alert for the out-of-band Regal scraper.
export async function sendAlertEmail(params: {
  to: string;
  kind: AlertKind;
  detail?: string;
}): Promise<void> {
  const { to, kind, detail } = params;
  const copy = ALERT_COPY[kind];
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0b0b0d;color:#e7e7ea;padding:24px">
    <div style="max-width:520px;margin:0 auto;background:#151519;border:1px solid #2a2a30;border-radius:12px;padding:24px">
      <h2 style="margin:0 0 12px;font-size:18px">${copy.heading}</h2>
      <p style="margin:0 0 12px;line-height:1.5;color:#c7c7cc">${copy.body}</p>
      ${detail ? `<p style="margin:0;font-family:monospace;font-size:12px;color:#8a8a90">${detail}</p>` : ""}
    </div>
  </body></html>`;

  if (!transporter) {
    console.warn("[email] GMAIL_USER/GMAIL_APP_PASSWORD missing; skipping sendAlertEmail", {
      to,
      kind,
    });
    return;
  }

  try {
    await transporter.sendMail({ from: FROM, to, subject: copy.subject, html });
  } catch (err) {
    console.warn("[email] sendAlertEmail failed:", err instanceof Error ? err.message : err);
  }
}

export async function sendReminderEmail(params: ReminderEmailParams): Promise<void> {
  const { to, movieTitle, theatreName, reminderNumber } = params;
  const subject = `⏱ ${movieTitle} 70mm at ${theatreName} — reminder ${reminderNumber} of 3`;
  const html = buildReminderEmailHtml(params);

  if (!transporter) {
    console.warn("[email] GMAIL_USER/GMAIL_APP_PASSWORD missing; skipping sendReminderEmail", { to, subject });
    return;
  }

  try {
    await transporter.sendMail({ from: FROM, to, subject, html });
  } catch (err) {
    console.warn("[email] sendReminderEmail failed:", err instanceof Error ? err.message : err);
  }
}
