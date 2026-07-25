// This repo is public and scraper/scrape.ts JSON.stringify's the whole
// /api/ingest and /api/scrape-config response into the (world-readable)
// GitHub Actions log. Prisma connection errors embed the DB host and
// credentials (e.g. "Can't reach database server at 'ep-xxxx.neon.tech:5432'"
// or a `user:pass@host:port` connection-string chunk). Strip that detail
// before any error string leaves the route, while leaving ordinary pipeline
// messages (e.g. "unknown theatre (AMC/amc-metreon-16); skipping") intact.
const CREDENTIAL_RE = /[A-Za-z0-9._%+-]+:[^\s@]+@[^\s'"]+/g;
const AT_HOST_PORT_RE = /at\s+['"`][^'"`]+:\d+['"`]/gi;
const NEON_HOST_RE = /[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.neon\.tech(?::\d+)?/gi;

export function redactError(message: string): string {
  return message
    .replace(CREDENTIAL_RE, "[redacted]")
    .replace(AT_HOST_PORT_RE, "at [redacted]")
    .replace(NEON_HOST_RE, "[redacted]");
}
