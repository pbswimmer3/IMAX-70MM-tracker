# PROJECT STATE
## Stack
- Frontend: Next.js 14 (App Router, TS)
- Backend/DB: Vercel serverless + Postgres (Neon) via Prisma; Auth.js v5 (Google); Resend email
- Infra: Vercel Hobby + free external cron (cron-job.org, ~10min POST /api/cron/poll)
## Current
- Objective: IMAX 70mm showtime-drop tracker (6 theatres, The Odyssey; extensible). Core app built + verified (npm run build passes).
- Branch: claude/imax-70mm-tracker-klhyd0
## Blockers (DATA SOURCE — scraper validated in CI; split result)
- [~] AMC: reachable from GitHub Actions (no Cloudflare block). Data is in Next.js App Router RSC payload (__next_f), not __NEXT_DATA__. Parser in progress (iter 3 dumps RSC field windows). Covers priority #1 Metreon + #3 CityWalk. VIABLE FREE.
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
- [x] Applied reviewer findings: movies admin gate + matcher validation (ADMIN_EMAILS), email-cap race (record-intent-before-send in both passes), constant-time cron auth. Build passes. Dismiss-unsubscribes-whole-movie confirmed intended.
- [ ] User: create accounts per SETUP.md, resolve AMC ids, deploy, wire cron
- [ ] Verify Regal adapter against live response once deployed
## Last Session
- Status: ACTIVE
- Verified: 2026-07-20 (build only; not yet run against live DB/APIs)
- Exit: clean
- Rollback: 5e8... (pre-app commit: plan/design checkpoint)
