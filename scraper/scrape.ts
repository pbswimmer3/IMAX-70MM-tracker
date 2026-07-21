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
    // Showtimes now stream into a Suspense boundary via a client fetch. Capture
    // the XHR/fetch responses the page makes so we can find the data source.
    const seenUrls = new Set<string>();
    const hits: string[] = [];
    const onResp = (resp: import("playwright").Response) => {
      const url = resp.url();
      const ct = resp.headers()["content-type"] || "";
      const interesting =
        /json|graphql/i.test(ct) ||
        /showtime|graphql|\/api\/|performance|movie/i.test(url);
      if (interesting && !seenUrls.has(url)) {
        seenUrls.add(url);
        hits.push(`${resp.status()} ${ct.split(";")[0]} ${url}`);
      }
    };
    page.on("response", onResp);
    await page.reload({ waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(3000);
    page.off("response", onResp);
    console.log(`[amc-diag] captured ${hits.length} candidate responses:`);
    for (const h of hits.slice(0, 25)) console.log(`[amc-diag]  ${h}`);
    // Did showtimes render into the DOM after the client fetch?
    const dom = await page.evaluate(() => {
      const bodyLen = document.body?.innerText?.length ?? 0;
      const loading = !!document.querySelector('[aria-label="Loading"]');
      const timeLinks = document.querySelectorAll('a[href*="/showtimes/"]').length;
      const buyBtns = document.querySelectorAll('[href*="/showtimes/"]').length;
      return { bodyLen, loading, timeLinks, buyBtns };
    });
    console.log(`[amc-diag] dom: ${JSON.stringify(dom)}`);
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
