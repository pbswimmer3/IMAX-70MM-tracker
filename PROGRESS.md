# PROJECT STATE
## Stack
- Frontend: Next.js (App Router) — planned
- Backend/DB: Vercel serverless + Postgres (Neon) via Prisma; NextAuth (Google); Resend email — planned
- Infra: Vercel Hobby + free external cron (cron-job.org) — planned
## Current
- Objective: Build IMAX 70mm showtime-drop tracker (6 theatres, The Odyssey; extensible)
- Branch: claude/imax-70mm-tracker-klhyd0
## Blockers
- [ ] Awaiting user sign-off on plan.md before writing app code (plan-first gate)
## Recent Changes
- [2026-07-20] plan.md: created full build plan | user locked auth=Google-only, cron=external ~10min, scope=all 6 theatres | n/a
- [2026-07-20] research: confirmed AMC official API + Regal getShowtimes endpoints feasible on free tier | data-source de-risk | n/a
## Next Actions
- [ ] Get plan confirmation
- [ ] Scaffold Next.js + Prisma + NextAuth
- [ ] Adapters (amc, regal) + poll/reminder/dismiss endpoints
- [ ] Dashboard + movies pages + SETUP.md
## Last Session
- Status: ACTIVE
- Verified: 2026-07-20
- Exit: clean
- Rollback: 9303a35
