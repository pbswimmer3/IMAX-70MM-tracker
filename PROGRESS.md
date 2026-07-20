# PROJECT STATE
## Stack
- Frontend: Next.js 14 (App Router, TS)
- Backend/DB: Vercel serverless + Postgres (Neon) via Prisma; Auth.js v5 (Google); Resend email
- Infra: Vercel Hobby + free external cron (cron-job.org, ~10min POST /api/cron/poll)
## Current
- Objective: IMAX 70mm showtime-drop tracker (6 theatres, The Odyssey; extensible). Core app built + verified (npm run build passes).
- Branch: claude/imax-70mm-tracker-klhyd0
## Blockers
- [ ] AMC numeric theatreIds unresolved (AMC hides them) — user runs `npm run resolve:amc` with vendor key, pastes into lib/theatres.ts. Regal IDs verified + filled.
- [ ] Regal adapter JSON field names are best-effort guesses — verify against a live getShowtimes response.
- [ ] Live-run verification pending real DB + API keys (SETUP.md).
## Recent Changes
- [2026-07-20] full Next.js app: prisma schema+seed, adapters (amc/regal), poll/dismiss/subscriptions/movies routes, auth (Google), Footage Counter + Safelight emails, dashboard/movies pages | build passes | delegated to implementer
- [2026-07-20] lib/theatres.ts + seed matchers: patched real Regal IDs (0347/1010/1484/1026), Odyssey AMC movieId 80679, Regal hoCodes ho00019076+ho00021807 | from ID research | n/a
- [2026-07-20] scripts/resolve-amc.ts + resolve:amc npm script: resolve AMC theatreIds via vendor key | AMC hides IDs publicly | typecheck via build
- [2026-07-20] SETUP.md + README: full account/deploy/cron walkthrough | onboarding | n/a
- [2026-07-20] design/notifications.html: 4 notification design directions (artifact) | chosen: Footage Counter + Safelight | published
## Next Actions
- [ ] Apply reviewer findings (review in flight)
- [ ] User: create accounts per SETUP.md, resolve AMC ids, deploy, wire cron
- [ ] Verify Regal adapter against live response once deployed
## Last Session
- Status: ACTIVE
- Verified: 2026-07-20 (build only; not yet run against live DB/APIs)
- Exit: clean
- Rollback: 5e8... (pre-app commit: plan/design checkpoint)
