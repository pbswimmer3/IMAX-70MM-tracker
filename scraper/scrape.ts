import { chromium, type Browser } from "playwright";
import { THEATRES, regalDateRange, regalGetShowtimesPath } from "./theatres";
import { normalizeAmcRecords, type RawAmcRecord } from "./parseAmc";
import { parseRegalJson } from "./parseRegal";
import type { NormalizedShowtimeLite, ScrapeTheatre } from "./types";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const APP_URL = process.env.APP_URL ?? "";
const CRON_SECRET = process.env.CRON_SECRET ?? "";
const DRY_RUN = ["true", "1", "yes"].includes((process.env.DRY_RUN ?? "").toLowerCase());
// How many days ahead to scan AMC showtimes (one page load per date).
const AMC_DATE_DAYS = 14;
// Which chains this run scrapes. GitHub Actions runs "AMC" (datacenter IP is
// fine for AMC); the home PC runs "REGAL" (needs a residential IP for Regal's
// Cloudflare). Default AMC so the existing GitHub workflow is unchanged.
const SCRAPE_CHAINS = new Set(
  (process.env.SCRAPE_CHAINS ?? "AMC")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean)
);
// Heartbeat source label when this run scrapes Regal (drives offline alerts).
const REGAL_SOURCE = "REGAL_PC";

interface TheatreResult {
  theatre: ScrapeTheatre;
  showtimes: NormalizedShowtimeLite[];
  blocked: boolean;
  error?: string;
}

async function fetchTheatreConfig(): Promise<ScrapeTheatre[]> {
  if (!APP_URL || !CRON_SECRET) {
    console.log("[scrape] APP_URL/CRON_SECRET not set; using local theatres.ts fallback");
    return THEATRES;
  }

  try {
    const res = await fetch(`${APP_URL}/api/scrape-config`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    if (!res.ok) {
      console.warn(`[scrape] /api/scrape-config returned ${res.status}; using local fallback`);
      return THEATRES;
    }
    const data = await res.json();
    const theatres = Array.isArray(data?.theatres) ? data.theatres : [];
    const mapped: ScrapeTheatre[] = theatres
      .filter((t: any) => t && typeof t.showtimesUrl === "string" && t.showtimesUrl.length > 0)
      .map((t: any) => ({
        chain: t.chain,
        externalId: t.externalId,
        name: t.name,
        showtimesUrl: t.showtimesUrl,
      }));
    if (mapped.length === 0) {
      console.warn("[scrape] scrape-config returned no usable theatres; using local fallback");
      return THEATRES;
    }
    return mapped;
  } catch (err) {
    console.warn(
      "[scrape] failed to fetch /api/scrape-config; using local fallback:",
      err instanceof Error ? err.message : err
    );
    return THEATRES;
  }
}

function looksLikeCloudflareChallenge(title: string, bodyText: string): boolean {
  const haystack = `${title} ${bodyText}`.toLowerCase();
  return (
    haystack.includes("just a moment") ||
    haystack.includes("attention required") ||
    haystack.includes("enable javascript")
  );
}

// Runs in the browser: extract every showtime from AMC's rendered DOM. Each
// movie is a <section aria-label="Showtimes for …">; showtimes are
// <a href="/showtimes/{id}"><time datetime="…"></a> grouped under experience
// headings shaped "FORMAT: ALL-CAPS TAGLINE" (e.g. "IMAX 70MM: EXTRAORDINARY
// AWAITS"). We walk each section in document order, tracking the current format
// heading, and attach it to the showtimes that follow. Self-contained (no outer
// closure refs) so it serializes into page.evaluate.
function extractAmcInPage(): RawAmcRecord[] {
  // "FORMAT: TAGLINE" where the tagline is all-caps — this uppercase tagline
  // requirement is what excludes time labels like "10:30pm" and attribute chips.
  const HEAD_RE = /^([A-Za-z0-9][A-Za-z0-9 &'/.+-]{1,40}):\s+[A-Z0-9][A-Z0-9 ,'&./-]{3,}$/;
  const out: RawAmcRecord[] = [];
  const sections = document.querySelectorAll('section[aria-label^="Showtimes for"]');
  sections.forEach((section) => {
    const aria = section.getAttribute("aria-label") || "";
    let movieTitle = (aria.match(/^Showtimes for (.+)$/) || [])[1]?.trim() || "";
    let movieExternalId: string | undefined;
    const movieLink = section.querySelector('a[href^="/movies/"]');
    if (movieLink) {
      if (!movieTitle) movieTitle = (movieLink.textContent || "").trim();
      movieExternalId = ((movieLink.getAttribute("href") || "").match(/\/movies\/.+-(\d+)/) || [])[1];
    }
    if (!movieExternalId) {
      movieExternalId = ((section.getAttribute("id") || "").match(/-(\d+)$/) || [])[1];
    }

    let currentFormat = "";
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_ELEMENT);
    let node: Node | null = walker.currentNode;
    while (node) {
      const el = node as HTMLElement;
      const txt = (el.textContent || "").trim();
      const hm = txt.match(HEAD_RE);
      if (hm) currentFormat = hm[1].trim();
      if (el.tagName === "A") {
        const sm = (el.getAttribute("href") || "").match(/^\/showtimes\/(\d+)/);
        if (sm) {
          const time = el.querySelector("time[datetime]");
          const dt = time ? time.getAttribute("datetime") : null;
          if (dt) {
            out.push({
              showtimeId: sm[1],
              datetimeIso: dt,
              movieExternalId,
              movieTitle,
              formatLabel: currentFormat,
            });
          }
        }
      }
      node = walker.nextNode();
    }
  });
  return out;
}

async function scrapeAmc(
  page: import("playwright").Page,
  baseUrl: string
): Promise<NormalizedShowtimeLite[]> {
  // AMC's page defaults to "today" (empty at night) and lazy-renders showtimes
  // on scroll. Iterate the next 14 dates via ?date=YYYY-MM-DD, scroll to trigger
  // rendering, then extract from the DOM. Dedupe by showtimeId across dates.
  const dates = regalDateRange(AMC_DATE_DAYS);
  const raw: RawAmcRecord[] = [];
  let datesWithShowtimes = 0;

  for (const ymd of dates) {
    try {
      await page.goto(`${baseUrl}?date=${ymd}`, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      for (let y = 0; y < 6; y++) {
        await page.evaluate((n) => window.scrollTo(0, n * window.innerHeight), y);
        await page.waitForTimeout(500);
      }
      // Wait for at least one showtime link, but don't stall on empty dates.
      await page
        .waitForSelector('section[aria-label^="Showtimes for"] a[href^="/showtimes/"]', {
          timeout: 6000,
        })
        .catch(() => {});
      const recs = await page.evaluate(extractAmcInPage);
      if (recs.length > 0) datesWithShowtimes++;
      raw.push(...recs);
    } catch (err) {
      console.log(
        `[scrape][amc] ${ymd} failed: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  const showtimes = normalizeAmcRecords(raw);
  console.log(
    `[scrape][amc] ${showtimes.length} showtimes over ${datesWithShowtimes}/${dates.length} dates with data`
  );
  return showtimes;
}

async function scrapeRegal(
  page: import("playwright").Page,
  externalId: string
): Promise<NormalizedShowtimeLite[]> {
  const dates = regalDateRange(14);
  const paths = dates.map((d) => regalGetShowtimesPath(externalId, d));

  await page.waitForLoadState("domcontentloaded").catch(() => {});
  let payloads: unknown[] = [];
  try {
    payloads = await page.evaluate(async (paths: string[]) => {
      const out: unknown[] = [];
      for (const path of paths) {
        try {
          const r = await fetch(path, { headers: { accept: "application/json" } });
          if (r.ok && (r.headers.get("content-type") || "").includes("json")) {
            out.push(await r.json());
          }
        } catch {
          // ignore individual date failures
        }
      }
      return out;
    }, paths);
  } catch (err) {
    console.log(
      `[scrape][regal] in-page fetch failed: ${err instanceof Error ? err.message : err}`
    );
  }

  const nonEmpty = payloads.filter((p) => p !== null && p !== undefined);
  console.log(
    `[scrape][regal] fetched ${payloads.length}/${dates.length} date payloads (${nonEmpty.length} non-empty)`
  );

  return parseRegalJson(payloads);
}

async function scrapeTheatre(browser: Browser, theatre: ScrapeTheatre): Promise<TheatreResult> {
  const context = await browser.newContext({
    userAgent: CHROME_UA,
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
  });
  const page = await context.newPage();

  try {
    await page.goto(theatre.showtimesUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    let title = await page.title();
    let bodyText = await page.evaluate(() => document.body?.innerText ?? "");
    console.log(`[scrape][${theatre.chain}] ${theatre.name}: title="${title}"`);

    let blocked = looksLikeCloudflareChallenge(title, bodyText);
    // Cloudflare managed challenge: poll for auto-clear, reloading between tries.
    for (let attempt = 1; blocked && attempt <= 3; attempt++) {
      console.log(
        `[scrape][${theatre.chain}] ${theatre.name}: challenge (attempt ${attempt}/3), waiting`
      );
      await page.waitForTimeout(7000);
      title = await page.title();
      bodyText = await page.evaluate(() => document.body?.innerText ?? "");
      blocked = looksLikeCloudflareChallenge(title, bodyText);
      if (blocked && attempt < 3) {
        await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
      }
    }
    console.log(
      `[scrape][${theatre.chain}] ${theatre.name}: ${blocked ? "still BLOCKED" : "challenge cleared / not challenged"}`
    );
    // Skip the data fetch if still blocked (avoids context-destroyed noise).
    if (blocked) {
      return { theatre, showtimes: [], blocked };
    }

    const showtimes =
      theatre.chain === "AMC"
        ? await scrapeAmc(page, theatre.showtimesUrl)
        : await scrapeRegal(page, theatre.externalId);

    const count70 = showtimes.filter((s) => s.is70mm).length;
    console.log(
      `[scrape][${theatre.chain}] ${theatre.name}: PASS — ${showtimes.length} showtimes, ${count70} are 70mm`
    );

    return { theatre, showtimes, blocked };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[scrape][${theatre.chain}] ${theatre.name}: ERROR — ${message}`);
    return { theatre, showtimes: [], blocked: false, error: message };
  } finally {
    await context.close();
  }
}

async function main() {
  const theatres = await fetchTheatreConfig();
  const browser = await chromium.launch({ headless: true });

  const results: TheatreResult[] = [];

  try {
    for (const theatre of theatres) {
      // Only scrape chains this run is responsible for (see SCRAPE_CHAINS).
      // Regal must run from a residential IP (home PC) — Cloudflare blocks
      // datacenter IPs; AMC runs fine from GitHub Actions.
      if (!SCRAPE_CHAINS.has(theatre.chain)) {
        console.log(`[scrape] ${theatre.name}: skipped (${theatre.chain} not in SCRAPE_CHAINS)`);
        continue;
      }
      try {
        const result = await scrapeTheatre(browser, theatre);
        results.push(result);
      } catch (err) {
        console.log(
          `[scrape] unexpected failure for ${theatre.name}: ${
            err instanceof Error ? err.message : err
          }`
        );
        results.push({
          theatre,
          showtimes: [],
          blocked: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await browser.close();
  }

  if (DRY_RUN) {
    for (const result of results) {
      const { theatre, showtimes, blocked, error } = result;
      const status = error ? `ERROR (${error})` : blocked ? "BLOCKED" : "PASS";
      const count70 = showtimes.filter((s) => s.is70mm).length;
      console.log(
        `[dry-run] ${theatre.name}: ${showtimes.length} showtimes (${count70} are 70mm) — ${status}`
      );
      for (const s of showtimes.slice(0, 4)) {
        console.log(`  sample: ${s.movieTitle} | ${s.startsAt} | ${s.format} | 70mm=${s.is70mm}`);
      }
      for (const s of showtimes.filter((s) => s.is70mm).slice(0, 4)) {
        console.log(`  70MM: ${s.movieTitle} (${s.movieExternalId}) | ${s.startsAt}`);
      }
    }

    const allErrored = results.length > 0 && results.every((r) => r.error);
    process.exit(allErrored ? 1 : 0);
    return;
  }

  if (!APP_URL || !CRON_SECRET) {
    console.error("[scrape] APP_URL/CRON_SECRET required to POST results; aborting POST");
    const allErrored = results.every((r) => r.error);
    process.exit(allErrored ? 1 : 0);
  }

  // If this run handled Regal (i.e. it's the home-PC scraper), attach a
  // heartbeat so the app's watchdog knows the PC is alive and whether Regal is
  // blocking us. blocked = every Regal theatre came back challenged/errored.
  const regalResults = results.filter((r) => r.theatre.chain === "REGAL");
  const sourceHealth =
    SCRAPE_CHAINS.has("REGAL") && regalResults.length > 0
      ? {
          source: REGAL_SOURCE,
          blocked: regalResults.every((r) => r.blocked || Boolean(r.error)),
        }
      : undefined;

  const body = {
    theatres: results.map((r) => ({
      externalId: r.theatre.externalId,
      chain: r.theatre.chain,
      showtimes: r.showtimes.filter((s) => s.is70mm),
    })),
    runReminders: true,
    ...(sourceHealth ? { sourceHealth } : {}),
  };

  try {
    const res = await fetch(`${APP_URL}/api/ingest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    console.log("[scrape] ingest response:", JSON.stringify(json));
  } catch (err) {
    console.error(
      "[scrape] POST to /api/ingest failed:",
      err instanceof Error ? err.message : err
    );
    const allErrored = results.every((r) => r.error);
    process.exit(allErrored ? 1 : 0);
    return;
  }

  const allErrored = results.every((r) => r.error);
  process.exit(allErrored ? 1 : 0);
}

main().catch((err) => {
  console.error("[scrape] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
