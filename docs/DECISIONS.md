# DECISIONS (grep-only, never read whole)
Design rationale moved verbatim from PROGRESS.md on 2026-10-19.

## Data-source history (why the current design)
- AMC official API: REJECTS vendor keys (HTTP 403 "Unauthorized VendorKey"). Dead.
- Regal getShowtimes API: Cloudflare 403 even from residential IP. Dead as bare fetch.
- Both /showtimes PAGES load in a real browser → headless-browser scraper chosen.
- AMC pages load fine from GitHub Actions datacenter IPs. Regal pages hit Cloudflare
  "Attention Required" managed challenge from datacenter IPs (0/4 cleared, 3 retries).
