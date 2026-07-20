# IMAX 70mm Tracker — Implementation Plan

## Decisions (locked with user)
- **Auth:** Google-only sign-in (NextAuth/Auth.js Google provider).
- **Polling:** Free external cron (cron-job.org or GitHub Actions) → pings a secret-protected Vercel endpoint every ~10 min. (Vercel Hobby cron = once/day, too slow; bypassed.)
- **Scope:** All 6 theatres, tracking The Odyssey; data model extensible to any 70mm movie.

## Stack
- **Framework:** Next.js (App Router) on Vercel — API routes + minimal dashboard.
- **DB:** Postgres (Neon / Vercel Postgres, free tier) via **Prisma**.
- **Auth:** NextAuth v5 (Auth.js) Google provider, Prisma adapter.
- **Email:** Resend (free tier 3k/mo). Email → phone push via Gmail/mail-app notifications (satisfies "push notif on phone"). Web Push (VAPID) left as future option.
- **Cost:** $0/mo (Neon free + Resend free + cron-job.org free + Vercel Hobby hosting).

## Theatres (chain → adapter)
| # | Theatre | Chain | Adapter |
|---|---------|-------|---------|
| 1 | AMC Metreon 16 & IMAX, SF | AMC | amc |
| 2 | Regal Hacienda Crossings, Dublin | Regal | regal |
| 3 | Universal Cinema AMC at CityWalk Hollywood | AMC | amc |
| 4 | Regal Irvine Spectrum, Irvine | Regal | regal |
| 5 | Regal LA Live, LA | Regal | regal |
| 6 | Regal Edwards Ontario Palace, Ontario | Regal | regal |

## Data sources (from research)
- **AMC adapter:** `GET https://api.amctheatres.com/v2/theatres/{theatreId}/showtimes/{M-D-YYYY}`, header `X-AMC-Vendor-Key`. Detect 70mm via `attributes` codes / `premiumFormat` (not movie title).
- **Regal adapter:** `GET https://www.regmovies.com/api/getShowtimes?theatres={cinemaId}&date=YYYY-MM-DD` with browser-like headers; key off IMAX-70mm `hoCode`/experience tag. Cloudflare-tolerant (retry/backoff, realistic UA).
- Each adapter is isolated + normalizes to a common `NormalizedShowtime` shape, so one chain breaking never affects the other.

## Data model (Prisma)
- **NextAuth tables:** User, Account, Session, VerificationToken.
- **Theatre:** id, chain, name, externalId, city, priority. (Seed the 6.)
- **Movie:** id, title, active, matchers(JSON: per-chain 70mm identifiers). (Seed The Odyssey.)
- **Subscription:** userId, movieId, theatreId(nullable=all). User's tracked movies.
- **Showtime:** id, movieId, theatreId, chain, startsAt, format, externalId, firstSeenAt. Unique(theatreId, externalId) → dedup / new-drop detection.
- **DropEvent:** movieId, theatreId, detectedAt — created on first 70mm showtime appearing for a movie×theatre.
- **Reminder:** userId, dropEventId, sentCount(0–3), lastSentAt, dismissed. Drives hourly-for-3h emails.

## Endpoints
- `GET/POST /api/auth/[...nextauth]` — Google sign-in.
- `POST /api/cron/poll` (Bearer CRON_SECRET) — for each active movie × theatre: fetch via adapter → detect new 70mm showtimes → upsert Showtime → on first appearance create DropEvent + Reminder(s) for subscribers + send drop email. Then process due reminders (send if ≥1h since last, sentCount<3, not dismissed).
- `GET /api/dismiss?token=...` — one-click from email (signed token, no login): marks reminders dismissed / unsubscribes movie.
- Pages: `/` (landing + sign-in), `/dashboard` (tracked movies, per-theatre known 70mm showtimes, toggle tracking, dismiss), `/movies` (add movie + matchers — admin/self-serve).

## Reminder logic
On drop → email #1 immediately. Cron (~10min) sends #2 at +1h, #3 at +2h (3 total, hourly), each with a "don't need to track this movie" dismiss link that stops further reminders.

## Setup the user must do (documented in SETUP.md)
1. Google Cloud → OAuth consent (External, email/profile scopes) + Web Client → `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, redirect `https://<domain>/api/auth/callback/google`.
2. AMC → apply for free vendor key → `AMC_VENDOR_KEY`.
3. Resend → `RESEND_API_KEY` + sender (onboarding domain works to start).
4. Neon/Vercel Postgres → `DATABASE_URL`.
5. `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `CRON_SECRET`.
6. External cron (cron-job.org) → POST `/api/cron/poll` every 10 min with `Authorization: Bearer <CRON_SECRET>`.

## Build order (subagent delegation per CLAUDE.md)
1. Scaffold Next.js + Prisma + NextAuth + deps (implementer).
2. Prisma schema + migrations + seed (6 theatres, Odyssey) (implementer).
3. Adapters: amc.ts, regal.ts + normalize + format-detection (implementer).
4. Poll + reminder + dismiss endpoints (implementer).
5. Dashboard + movies pages (implementer).
6. SETUP.md + .env.example (grunt).
7. Reviewer pass on full diff before commit.

## Deliverables outside the app
- **HTML artifact** exploring overlay/caption designs for drop notifications (email header art + in-app cards). Delivered with this plan.
