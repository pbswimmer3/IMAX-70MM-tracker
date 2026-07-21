import { chromium, type Browser } from "playwright";
import { THEATRES, regalDateRange, regalGetShowtimesPath } from "./theatres";
import { decodeNextFlight, parseAmcRsc } from "./parseAmc";
import { parseRegalJson } from "./parseRegal";
import type { NormalizedShowtimeLite, ScrapeTheatre } from "./types";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const APP_URL = process.env.APP_URL ?? "";
const CRON_SECRET = process.env.CRON_SECRET ?? "";
const DRY_RUN = ["true", "1", "yes"].includes((process.env.DRY_RUN ?? "").toLowerCase());

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

async function scrapeAmc(
  page: import("playwright").Page,
  bookingFallback: string
): Promise<NormalizedShowtimeLite[]> {
  // Let client-side content render (AMC hydrates after load).
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // AMC is Next.js App Router: showtime data is in the streaming RSC payload
  // (self.__next_f.push([...])). Grab those scripts, decode, and parse.
  const rawNextF = await page.evaluate(() =>
    Array.from(document.querySelectorAll("script"))
      .map((s) => s.textContent || "")
      .filter((t) => t.includes("__next_f"))
      .join("\n")
  );
  const stream = decodeNextFlight(rawNextF);
  const showtimes = parseAmcRsc(stream, bookingFallback);
  if (showtimes.length === 0) {
    console.log(`[scrape][amc] no showtimes parsed (streamLen=${stream.length}) — page shape may have changed`);
    // TEMP DIAGNOSTIC (remove after fixing parser): report which key tokens
    // exist in the current stream + a context window so we can see the shape.
    const keys = [
      "showtimeId", "showDateTimeUtc", "showDateTime", "aria-describedby",
      "performances", "performance", "No showtimes", "no showtimes",
      "70mm", "imax70mm", "premiumFormat", "attributes", "showtime",
    ];
    const counts = keys
      .map((k) => `${k}=${stream.split(k).length - 1}`)
      .join(" ");
    console.log(`[amc-diag] tokens: ${counts}`);
    // Hypothesis: the showtime list lazy-loads on scroll (IntersectionObserver)
    // and never enters the viewport headless. Scroll through the page, wait for
    // the loading skeleton to clear, then inspect the rendered DOM.
    for (let y = 0; y < 8; y++) {
      await page.evaluate((n) => window.scrollTo(0, n * window.innerHeight), y);
      await page.waitForTimeout(800);
    }
    await page
      .waitForFunction(() => !document.querySelector('[aria-label="Loading"]'), { timeout: 12000 })
      .catch(() => {});
    await page.waitForTimeout(1500);
    const dom = await page.evaluate(() => {
      const bodyLen = document.body?.innerText?.length ?? 0;
      const loading = !!document.querySelector('[aria-label="Loading"]');
      const links = Array.from(document.querySelectorAll("a[href]"))
        .map((a) => (a as HTMLAnchorElement).getAttribute("href") || "")
        .filter((h) => /showtime|\/movies\/|\/tickets|reserve|seat/i.test(h));
      const container =
        document.querySelector("#showtime-results") ||
        document.querySelector('[aria-label="Filtered Showtime Results"]');
      const sample = container ? (container as HTMLElement).innerText.slice(0, 700) : "(no container)";
      const html = container ? (container as HTMLElement).innerHTML.slice(0, 900) : "";
      return { bodyLen, loading, linkCount: links.length, links: links.slice(0, 6), sample, html };
    });
    console.log(`[amc-diag] afterScroll(today): bodyLen=${dom.bodyLen} loading=${dom.loading} links=${dom.linkCount}`);
    // Today is empty at night. Load TOMORROW to capture a POPULATED card so we
    // can write a correct DOM parser (times + format badges + booking links).
    const tomorrow = `${bookingFallback}?date=tomorrow`;
    await page.goto(tomorrow, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    for (let y = 0; y < 8; y++) {
      await page.evaluate((n) => window.scrollTo(0, n * window.innerHeight), y);
      await page.waitForTimeout(700);
    }
    await page
      .waitForFunction(() => !document.querySelector('[aria-label="Loading"]'), { timeout: 12000 })
      .catch(() => {});
    await page.waitForTimeout(1500);
    const tm = await page.evaluate(() => {
      const bodyLen = document.body?.innerText?.length ?? 0;
      const loading = !!document.querySelector('[aria-label="Loading"]');
      const container =
        document.querySelector("#showtime-results") || document.body;
      const text = (container as HTMLElement).innerText;
      // Find the Odyssey block and dump the HTML around it to reveal structure.
      const html = (container as HTMLElement).innerHTML;
      const oIdx = html.search(/odyssey/i);
      const block = oIdx >= 0 ? html.slice(oIdx - 200, oIdx + 1600) : html.slice(0, 1600);
      const reserveLinks = Array.from(document.querySelectorAll("a[href]"))
        .map((a) => (a as HTMLAnchorElement).getAttribute("href") || "")
        .filter((h) => /reserve|showtimes\/|ticket|seat/i.test(h))
        .slice(0, 8);
      return { bodyLen, loading, textSlice: text.slice(0, 600), block, reserveLinks };
    });
    console.log(`[amc-diag] TOMORROW: bodyLen=${tm.bodyLen} loading=${tm.loading}`);
    console.log(`[amc-diag] tm-text: ${tm.textSlice.replace(/\s+/g, " ")}`);
    console.log(`[amc-diag] tm-reserveLinks: ${JSON.stringify(tm.reserveLinks)}`);
    console.log(`[amc-diag] tm-block: ${tm.block.replace(/\s+/g, " ")}`);
  }
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
      // Regal is deferred: Cloudflare's managed challenge blocks datacenter IPs
      // (confirmed 0/4 in CI). Re-enable when a residential proxy is wired in.
      if (theatre.chain === "REGAL") {
        console.log(`[scrape] ${theatre.name}: deferred (Regal blocked on datacenter IPs)`);
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

  const body = {
    theatres: results.map((r) => ({
      externalId: r.theatre.externalId,
      chain: r.theatre.chain,
      showtimes: r.showtimes.filter((s) => s.is70mm),
    })),
    runReminders: true,
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
