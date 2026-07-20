import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.EMAIL_FROM ?? "IMAX 70mm Tracker <alerts@example.com>";

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

  if (!resend) {
    console.warn("[email] RESEND_API_KEY missing; skipping sendDropEmail", { to, subject });
    return;
  }

  try {
    await resend.emails.send({ from: FROM, to, subject, html });
  } catch (err) {
    console.warn("[email] sendDropEmail failed:", err instanceof Error ? err.message : err);
  }
}

export async function sendReminderEmail(params: ReminderEmailParams): Promise<void> {
  const { to, movieTitle, theatreName, reminderNumber } = params;
  const subject = `⏱ ${movieTitle} 70mm at ${theatreName} — reminder ${reminderNumber} of 3`;
  const html = buildReminderEmailHtml(params);

  if (!resend) {
    console.warn("[email] RESEND_API_KEY missing; skipping sendReminderEmail", { to, subject });
    return;
  }

  try {
    await resend.emails.send({ from: FROM, to, subject, html });
  } catch (err) {
    console.warn("[email] sendReminderEmail failed:", err instanceof Error ? err.message : err);
  }
}
