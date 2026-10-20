# PROJECT STATE
IMAX 70mm showtime-drop tracker. History: `docs/HISTORY.md`; rationale: `docs/DECISIONS.md` (both grep-only, never read whole).
## Stack
- Frontend: Next.js 14 (App Router, TS)
- Backend/DB: Vercel serverless + Postgres (Neon) via Prisma; Auth.js v5 (Google); Gmail SMTP email (nodemailer)
- Infra: Vercel Hobby; Playwright scraper in `scraper/` (AMC on GitHub Actions `scrape.yml`; Regal on the home Windows PC via Task Scheduler `run-regal.cmd`) POSTs to /api/ingest
## Current
- Objective: keep AMC (2 theatres) + Regal (4 theatres) scraping live; Regal restored 2026-07-29 after the manual `git pull` outage
- Branch: `fix/regal-parser-restore` (newest entry, 2026-07-29; merge state not recorded)
## Blockers
- [ ] Home PC `run-regal.cmd` has no auto-pull installed, so the PC will not pick up Regal fixes on its own
- [ ] `lib/match.ts` + `lib/theatres.ts` hoCode matcher fix needs a Vercel deploy to take effect in prod
- [ ] Task Scheduler "Regal scraper" is Interactive: runs only while pradb is logged on (S4U re-register needs an elevated shell)
## Recent Changes
- 2026-07-29 scraper/parseRegal.ts, scrape.ts: Regal restored (cherry-pick 449fad6 driven by probeHorizon; per-fetch timeouts, 6-min deadline) | `git pull` replaced working parser | live: 4 Regal theatres PASS
- 2026-07-29 scrape.ts, run-regal.cmd, REGAL-PC-SETUP.md: revision banner + `git pull --ff-only` + gitignore secrets | horizon fix not running on PC | smoke-tested
- 2026-07-29 scraper Regal horizon walk replaces fixed `regalDateRange(14)` | dashboard capped at Aug 10 | tests 62→79
- 2026-07-28 scraper/parseRegal.ts rewritten against a real payload; Regal live from home PC | guessed schema matched nothing | 77/77 vitest, 2 live ingests errors=[]
- 2026-07-27 lib/dates.ts, lib/pipeline.ts, app/dashboard: date-sort toggle + Pacific-timezone rendering | showtimes 7h ahead | 62/62 vitest, next build clean
- 2026-07-27 PRs #12 (bootstrap) + #13 (matcher repair + FULL_SCAN + diagnostics) merged @bd98c06 | empty-dashboard outage | backfill 277 showtimes / 46 drops
- 2026-07-21 Regal-on-PC scraping + heartbeat alerts (SCRAPE_CHAINS, SourceHealth) | Change #3 | built
- 2026-07-21 parseAmc.ts DOM-based + scrapeAmc date iteration | Change #1 | CI dry-run 70mm detected at both AMC theatres
## Next Actions
- [ ] Delete dead guessed-schema parser `lib/adapters/regal.ts`
- [ ] Install auto-pull in the PC's local `run-regal.cmd`; check the startup banner sha against main
- [ ] Vercel deploy for the matcher fix; confirm Vercel envs `ALERT_EMAIL` / `HEARTBEAT_STALE_MINUTES`
- [ ] Run a FULL_SCAN backfill after any matcher/parser fix (probeHorizon resumes from storedHorizon-2)
- [ ] Follow-up: remove dead-but-kept nudge/dismiss code (sendDropEmails, Reminder, /api/dismiss, /api/cron/poll) if unwanted
## Last Session
- Status: STALE (newest entry 2026-07-29 ~02:30; verify branch/merge state before trusting)
- Verified: 2026-07-29 02:24-02:31 live run, all 4 Regal theatres PASS
- Exit: clean (last recorded, 2026-07-28 session)
- Rollback: not recorded for 2026-07-29; last recorded main @180a233 (2026-07-28)
