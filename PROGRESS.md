# PROJECT STATE
## Stack
- Frontend: Next.js 14 (App Router, TS)
- Backend/DB: Vercel serverless + Postgres (Neon) via Prisma; Auth.js v5 (Google); Resend email
- Infra: Vercel Hobby + free external cron (cron-job.org, ~10min POST /api/cron/poll)
## Current
- Objective: IMAX 70mm showtime-drop tracker (6 theatres, The Odyssey; extensible). Core app built + verified (npm run build passes).
- Branch: claude/imax-70mm-tracker-klhyd0
## Blockers (DATA SOURCE — AMC validated end-to-end in CI; Regal deferred)
- [x] AMC: VALIDATED. Scraper parses Next.js RSC (__next_f); extracts ~16 showtimes/theatre with correct titles/times and per-showtime is70mm (from aria-describedby format codes). CI dry-run currently detects The Odyssey IMAX 70mm at BOTH Metreon (#1) and CityWalk (#3) — movie id 76238, is70mm=true. Matcher updated to movieIds ["76238","80679"] + titlePattern odyssey. Feeds /api/ingest. FREE, hands-off.
- [!] REGAL: hard Cloudflare "Attention Required" managed challenge on GH Actions datacenter IPs — 0/4 theatres cleared even with 3-attempt retry. CI-hosted free scraping NOT viable for Regal (#2 Hacienda, #4 Irvine, #5 LA Live, #6 Ontario). USER DECISION: ship AMC-only free, DEFER Regal (re-enable later with residential proxy). Scraper should skip REGAL for now; keep in config for easy re-enable.
- Direct APIs remain dead (AMC vendor key 403; Regal getShowtimes CF-blocked even residential).
- App logic (auth, DB, pipeline, emails, reminders, dashboard, /api/ingest) built + builds; ingestion path proven for AMC.
## Recent Changes
- [2026-07-20] full Next.js app: prisma schema+seed, adapters (amc/regal), poll/dismiss/subscriptions/movies routes, auth (Google), Footage Counter + Safelight emails, dashboard/movies pages | build passes | delegated to implementer
- [2026-07-20] lib/theatres.ts + seed matchers: patched real Regal IDs (0347/1010/1484/1026), Odyssey AMC movieId 80679, Regal hoCodes ho00019076+ho00021807 | from ID research | n/a
- [2026-07-20] scripts/resolve-amc.ts + resolve:amc npm script: resolve AMC theatreIds via vendor key | AMC hides IDs publicly | typecheck via build
- [2026-07-20] SETUP.md + README: full account/deploy/cron walkthrough | onboarding | n/a
- [2026-07-20] design/notifications.html: 4 notification design directions (artifact) | chosen: Footage Counter + Safelight | published
## Next Actions
- [x] AMC scraper validated in CI (detects Odyssey 70mm at Metreon + CityWalk).
- [ ] GO-LIVE (on user's readiness): remove temp `push` trigger from scrape.yml; user deploys to Vercel, sets env + GitHub secrets APP_URL/CRON_SECRET; scraper runs every 30 min posting to /api/ingest.
- [ ] SETUP.md rewrite for scraper architecture (no AMC vendor key; GitHub Actions instead of cron-job.org; Regal deferred).
- [ ] Later: re-enable Regal via residential proxy (flip skip in scraper).
## Last Session
- Status: ACTIVE
- Verified: 2026-07-20 (build only; not yet run against live DB/APIs)
- Exit: clean
- Rollback: 5e8... (pre-app commit: plan/design checkpoint)
