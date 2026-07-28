import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import { THEATRES, regalGetShowtimesPath, todayYmd } from "./theatres";
import { normalizeAmcRecords, type RawAmcRecord } from "./parseAmc";
import { parseRegalDatePayload, type RegalParseStats } from "./parseRegal";
import { probeHorizon } from "./probe";
import { shouldFailRun } from "./shouldFailRun";
import { summarize70mm } from "./summarize70mm";
import type { NormalizedShowtimeLite, ScrapeTheatre } from "./types";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const APP_URL = process.env.APP_URL ?? "";
const CRON_SECRET = process.env.CRON_SECRET ?? "";
const DRY_RUN = ["true", "1", "yes"].includes((process.env.DRY_RUN ?? "").toLowerCase());
// Escape hatch: ignore each theatre's stored booking horizon and rescan from
// today. Needed to diagnose a suspected match/ingest bug (a dry run
// otherwise only reaches dates near the already-stored horizon, see
// probe.ts) and to backfill once such a bug is fixed.
const FULL_SCAN = process.env.FULL_SCAN === "1" || process.env.FULL_SCAN === "true";
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
  observedHorizon: string | null;
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
        horizonDate: t.horizonDate ?? null,
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

// Quotes a present value (including an empty string, printed as `""`) so it
// is visually distinguishable from a genuinely missing (undefined) value.
function fmtField(v: string | undefined): string {
  return v === undefined ? "<missing>" : `"${v}"`;
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
  baseUrl: string,
  storedHorizon: string | null
): Promise<{ showtimes: NormalizedShowtimeLite[]; observedHorizon: string | null }> {
  // AMC's page defaults to "today" (empty at night) and lazy-renders showtimes
  // on scroll. Probe forward from the (lookback-adjusted) stored booking horizon
  // via ?date=YYYY-MM-DD, scroll to trigger rendering, then extract from the DOM,
  // stopping shortly past the first empty day. Dedupe by showtimeId across dates.
  const dateUrl = (ymd: string) =>
    `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}date=${ymd}`;
  const fetchDate = async (ymd: string): Promise<RawAmcRecord[]> => {
    try {
      // Retry the navigation once: a single transient goto failure returning []
      // would look like a genuinely empty date and could prematurely truncate
      // the horizon (which is written back to Theatre.horizonDate).
      try {
        await page.goto(dateUrl(ymd), { waitUntil: "domcontentloaded", timeout: 45000 });
      } catch {
        await page.goto(dateUrl(ymd), { waitUntil: "domcontentloaded", timeout: 45000 });
      }
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
      return await page.evaluate(extractAmcInPage);
    } catch (err) {
      console.log(
        `[scrape][amc] ${ymd} failed: ${err instanceof Error ? err.message : err}`
      );
      return [];
    }
  };

  const result = await probeHorizon(fetchDate, { today: todayYmd(), storedHorizon });
  const showtimes = normalizeAmcRecords(result.records);
  console.log(
    `[scrape][amc] ${showtimes.length} showtimes over ${result.datesWithShowtimes}/${result.datesProbed.length} dates with data (horizon=${result.observedHorizon})`
  );
  return { showtimes, observedHorizon: result.observedHorizon };
}

// A Regal date probe is ONE same-origin JSON fetch, versus AMC's full page load
// + 6 scroll passes. That much lower per-date cost is why Regal tolerates a
// longer run of empty days before declaring the booking window over: a midweek
// dark day (or a 2-3 day gap between engagements) must not truncate the horizon.
const REGAL_OVERSHOOT = 3;

// In-page fetch timeout. A stalled Regal response used to hang the in-page
// `fetch` (and therefore the whole sequential horizon walk) forever — this
// bounds a single date's request.
//
// Sized from a measured full 4-theatre walk (2026-07-29, 105 successful date
// fetches): min 169ms, median 400ms, p95 629ms, max 746ms. 6s is ~8x the
// observed worst case. This is deliberately not generous: dates PAST the
// booking horizon do not 404, they stall, so every theatre pays
// REGAL_OVERSHOOT+1 timeouts at the end of its walk. At the original 20s that
// overshoot was 5.3 of the run's 7.2 minutes — the timeout value, not the
// scraping, was the dominant cost of a run.
export const REGAL_FETCH_TIMEOUT_MS = 6000;
// Outer guard on the page.evaluate call itself. A hung V8 context inside the
// page can outlive the in-page AbortSignal.timeout above, so the evaluate
// call is separately raced against this timer. Kept above
// REGAL_FETCH_TIMEOUT_MS so the in-page abort is what normally fires (it
// reports the more precise reason); this is the backstop.
export const REGAL_EVALUATE_TIMEOUT_MS = 8000;
// Wall-clock budget for ONE theatre's entire date-by-date walk. Exceeding it
// aborts the walk (see the "DEADLINE ABORT" log line) instead of returning a
// truncated observedHorizon, which would otherwise get persisted to the DB
// and permanently cap future scans wherever the walk happened to stall.
export const REGAL_WALK_DEADLINE_MS = 6 * 60 * 1000;
// Delay between sequential date requests to the same theatre. The walk now
// issues far more sequential requests to Regal from a single residential IP
// than this scraper has ever made in production.
export const REGAL_REQUEST_DELAY_MS = 500;

type RegalFetchOutcome = { ok: true; json: unknown } | { ok: false; reason: string };

// Blocked means the API itself is unreachable, not merely quiet: derive it
// from transport failures only, never from "parsed fine but zero shows",
// so a theatre with a legitimately dark week is never reported BLOCKED (and
// never trips the REGAL_PC offline heartbeat / false outage alert).
export function deriveRegalApiBlocked(datesAttempted: number, datesTransportFail: number): boolean {
  return datesAttempted > 0 && datesTransportFail === datesAttempted;
}

// A deadline-aborted walk must never report a truncated horizon: returning
// null here is what stops scrape.ts from writing a wrong, permanently-capping
// booking horizon back to the DB.
export function resolveRegalObservedHorizon(
  observedHorizon: string | null,
  deadlineExceeded: boolean
): string | null {
  return deadlineExceeded ? null : observedHorizon;
}

async function scrapeRegal(
  page: import("playwright").Page,
  externalId: string,
  showtimesUrl: string,
  storedHorizon: string | null
): Promise<{
  showtimes: NormalizedShowtimeLite[];
  observedHorizon: string | null;
  apiBlocked: boolean;
}> {
  // Fetch one date at a time so probeHorizon can walk forward to the ACTUAL end
  // of Regal's booking window. This previously used a hard-coded 14-day range,
  // which silently capped every Regal theatre at today+13 — showtimes on sale
  // beyond that were never requested, so they never appeared in the dashboard.
  // Stays an in-page same-origin fetch: that's what carries the Cloudflare
  // clearance cookie earned by the theatre-page load.
  let datesAttempted = 0;
  let datesOkJson = 0;
  let datesTransportFail = 0;
  // Hoisted to the whole theatre's walk (not per date) so a PerformanceId that
  // reappears on a later date — Regal echoes some performances on adjacent
  // dates near midnight boundaries — is deduped across the whole walk instead
  // of colliding silently (last write wins) inside a single date's payload.
  const seen = new Map<string, string>();
  const stats: RegalParseStats = {
    performances: 0,
    kept: 0,
    noTime: 0,
    noId: 0,
    dupSameStart: 0,
    dupDifferentStart: 0,
    theatreMismatch: 0,
  };

  // Runs in the page: one same-origin fetch bounded by both an in-page abort
  // (fires first, in the common case) and never throws — every failure mode
  // (bad status, non-JSON, bad JSON body, network error) resolves to
  // { ok: false, reason }, so the caller can tell TRANSPORT_FAIL apart from a
  // legitimately empty OK_JSON date.
  const fetchJsonForDate = (path: string): Promise<RegalFetchOutcome> => {
    const evaluatePromise: Promise<RegalFetchOutcome> = page
      .evaluate(async (p: string) => {
        try {
          const r = await fetch(p, {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(15000),
          });
          if (!r.ok) return { ok: false as const, reason: `http ${r.status}` };
          if (!(r.headers.get("content-type") || "").includes("json")) {
            return { ok: false as const, reason: "non-json content-type" };
          }
          try {
            return { ok: true as const, json: await r.json() };
          } catch {
            return { ok: false as const, reason: "invalid json body" };
          }
        } catch (err) {
          return {
            ok: false as const,
            reason: err instanceof Error ? err.message : "in-page fetch failed",
          };
        }
      }, path)
      .catch(
        (err): RegalFetchOutcome => ({
          ok: false,
          reason: err instanceof Error ? err.message : "page.evaluate rejected",
        })
      );

    const timeoutPromise: Promise<RegalFetchOutcome> = new Promise((resolve) => {
      setTimeout(
        () =>
          resolve({
            ok: false,
            reason: `page.evaluate timed out (${REGAL_EVALUATE_TIMEOUT_MS}ms)`,
          }),
        REGAL_EVALUATE_TIMEOUT_MS
      );
    });

    // The evaluate promise is never allowed to reject (caught above), so it's
    // safe to let it keep running in the background after the timeout wins —
    // no unhandled rejection when/if it eventually settles.
    return Promise.race([evaluatePromise, timeoutPromise]);
  };

  const fetchDate = async (ymd: string): Promise<NormalizedShowtimeLite[]> => {
    const path = regalGetShowtimesPath(externalId, ymd);
    datesAttempted++;
    // Polite pacing: don't delay the first request, only between requests.
    if (datesAttempted > 1) {
      await new Promise((resolve) => setTimeout(resolve, REGAL_REQUEST_DELAY_MS));
    }

    const startedAt = Date.now();
    const outcome = await fetchJsonForDate(path);
    const elapsedMs = Date.now() - startedAt;

    if (!outcome.ok) {
      datesTransportFail++;
      console.log(`[scrape][regal] ${ymd}: TRANSPORT_FAIL (${outcome.reason}) in ${elapsedMs}ms`);
      return [];
    }

    datesOkJson++;
    const { showtimes, stats: dateStats } = parseRegalDatePayload(outcome.json, externalId, ymd, seen);
    stats.performances += dateStats.performances;
    stats.kept += dateStats.kept;
    stats.noTime += dateStats.noTime;
    stats.noId += dateStats.noId;
    stats.dupSameStart += dateStats.dupSameStart;
    stats.dupDifferentStart += dateStats.dupDifferentStart;
    stats.theatreMismatch += dateStats.theatreMismatch;

    const count70 = showtimes.filter((s) => s.is70mm).length;
    console.log(
      `[scrape][regal] ${ymd}: ${showtimes.length} showtimes (${count70} 70mm) in ${elapsedMs}ms`
    );
    return showtimes;
  };

  await page.waitForLoadState("domcontentloaded").catch(() => {});

  const result = await probeHorizon(fetchDate, {
    today: todayYmd(),
    storedHorizon,
    overshoot: REGAL_OVERSHOOT,
    // showDate is already stamped by parseRegalDatePayload (preferring the
    // payload's own advertised date, falling back to the queried date); don't
    // let the default tag write AMC's queryDate onto a normalized record.
    tag: () => {},
    deadlineMs: REGAL_WALK_DEADLINE_MS,
  });

  if (result.deadlineExceeded) {
    console.log(
      `[scrape][regal] DEADLINE ABORT: exceeded ${REGAL_WALK_DEADLINE_MS}ms wall-clock budget ` +
        `after ${result.datesProbed.length} dates (${datesTransportFail} transport failures) — ` +
        `refusing to persist a truncated horizon`
    );
  }
  const observedHorizon = resolveRegalObservedHorizon(result.observedHorizon, result.deadlineExceeded);

  // A Cloudflare-blocked API can coexist with a healthy HTML page (the
  // 2026-07-25 outage class): if every attempted date failed at the
  // transport layer, treat the API itself as blocked so the caller can mark
  // the theatre BLOCKED instead of silently reporting a no-70mm night.
  const apiBlocked = deriveRegalApiBlocked(datesAttempted, datesTransportFail);

  console.log(
    `[scrape][regal] stats: performances=${stats.performances} kept=${stats.kept} noTime=${stats.noTime} ` +
      `noId=${stats.noId} dupSameStart=${stats.dupSameStart} dupDifferentStart=${stats.dupDifferentStart} ` +
      `theatreMismatch=${stats.theatreMismatch}`
  );

  const count70 = result.records.filter((s) => s.is70mm).length;
  console.log(
    `[scrape][regal] ${result.records.length} showtimes (${count70} are 70mm) over ` +
      `${result.datesWithShowtimes}/${result.datesProbed.length} dates with data ` +
      `(datesAttempted=${datesAttempted} okJson=${datesOkJson} transportFail=${datesTransportFail}, ` +
      `horizon=${observedHorizon})`
  );

  // getShowtimes carries no per-performance purchase URL, so link to the
  // theatre's showtimes page (same fallback AMC uses).
  return {
    showtimes: result.records.map((s) => ({ ...s, bookingUrl: showtimesUrl })),
    observedHorizon,
    apiBlocked,
  };
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
      return { theatre, showtimes: [], blocked, observedHorizon: null };
    }

    const storedHorizon = FULL_SCAN ? null : theatre.horizonDate ?? null;
    let showtimes: NormalizedShowtimeLite[];
    let observedHorizon: string | null;
    if (theatre.chain === "AMC") {
      const result = await scrapeAmc(page, theatre.showtimesUrl, storedHorizon);
      showtimes = result.showtimes;
      observedHorizon = result.observedHorizon;
    } else {
      const result = await scrapeRegal(
        page,
        theatre.externalId,
        theatre.showtimesUrl,
        storedHorizon
      );
      showtimes = result.showtimes;
      observedHorizon = result.observedHorizon;
      // OR with the existing HTML-challenge check: either signal alone means blocked.
      blocked = blocked || result.apiBlocked;
    }

    const count70 = showtimes.filter((s) => s.is70mm).length;
    // Gate the PASS label on `blocked` (set above, possibly by Regal's
    // apiBlocked) — an API-blocked theatre must never log as a healthy empty
    // night.
    const label = blocked ? "BLOCKED" : "PASS";
    console.log(
      `[scrape][${theatre.chain}] ${theatre.name}: ${label} — ${showtimes.length} showtimes, ${count70} are 70mm`
    );

    return { theatre, showtimes, blocked, observedHorizon };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[scrape][${theatre.chain}] ${theatre.name}: ERROR — ${message}`);
    return { theatre, showtimes: [], blocked: false, observedHorizon: null, error: message };
  } finally {
    await context.close();
  }
}

// Which commit this process is actually running. The Regal scraper runs from a
// clone on a home PC that nothing auto-updates, so a merged fix can sit unused
// indefinitely with the logs looking completely healthy — that is exactly how
// the 14-day Regal horizon cap survived its own fix. Print the revision every
// run so a stale checkout is visible in regal.log rather than silent.
function scraperRevision(): string {
  // This package is "type": "module", so __dirname/require do not exist at
  // runtime — resolve the script's own directory from import.meta instead, and
  // run git there so the lookup doesn't depend on the caller's cwd.
  const here = dirname(fileURLToPath(import.meta.url));
  const git = (args: string[]): string =>
    execFileSync("git", args, {
      cwd: here,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  try {
    const sha = git(["rev-parse", "--short", "HEAD"]);
    return git(["status", "--porcelain"]) ? `${sha}-dirty` : sha;
  } catch {
    // Not a git checkout, or git isn't on PATH — non-fatal, just less diagnosable.
    return "unknown";
  }
}

async function main() {
  console.log(
    `[scrape] revision=${scraperRevision()} chains=${[...SCRAPE_CHAINS].join(",")} ` +
      `today=${todayYmd()} dryRun=${DRY_RUN} fullScan=${FULL_SCAN}`
  );
  if (FULL_SCAN) {
    console.log("[scrape] FULL_SCAN: ignoring stored horizons, scanning from today");
  }
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
          observedHorizon: null,
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

      const groups = summarize70mm(showtimes);
      if (groups.length > 0) {
        console.log(
          `[dry-run] ${theatre.name}: 70mm breakdown (${count70} records, ${groups.length} distinct)`
        );
        for (const g of groups) {
          console.log(
            `    ${g.count}x  title=${fmtField(g.movieTitle)}  movieExternalId=${fmtField(g.movieExternalId)}  format=${fmtField(g.format)}`
          );
          for (const sample of g.samples) {
            console.log(
              `        sample: externalId=${fmtField(sample.externalId)}  startsAt=${fmtField(sample.startsAt)}  title=${fmtField(sample.movieTitle)}  movieExternalId=${fmtField(sample.movieExternalId)}  format=${fmtField(sample.format)}`
            );
          }
        }
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
      observedHorizon: r.observedHorizon,
    })),
    runReminders: true,
    ...(sourceHealth ? { sourceHealth } : {}),
  };
  const theatresPosted = body.theatres.length;
  const showtimesPosted = body.theatres.reduce((sum, t) => sum + t.showtimes.length, 0);

  let ingestFailed = false;
  try {
    const res = await fetch(`${APP_URL}/api/ingest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "<no body>");
      console.error(
        `[scrape] ingest POST failed: status=${res.status}, body=${bodyText.slice(0, 2000)}`
      );
      ingestFailed = shouldFailRun({
        postFailed: true,
        errors: [],
        theatresPosted,
        showtimesPosted,
        dryRun: DRY_RUN,
      });
    } else {
      const json = await res.json();
      console.log("[scrape] ingest response:", JSON.stringify(json));

      const theatresMatched =
        typeof json?.theatresMatched === "number" ? json.theatresMatched : undefined;
      const activeMovies =
        typeof json?.activeMovies === "number" ? json.activeMovies : undefined;
      const showtimesUpserted =
        typeof json?.showtimesUpserted === "number" ? json.showtimesUpserted : undefined;
      const responseErrors: string[] = Array.isArray(json?.errors) ? json.errors : [];

      if (
        shouldFailRun({
          postFailed: false,
          errors: responseErrors,
          activeMovies,
          theatresPosted,
          theatresMatched,
          showtimesPosted,
          showtimesUpserted,
          dryRun: DRY_RUN,
        })
      ) {
        ingestFailed = true;
        console.error(
          `[scrape] FAILED: theatresPosted=${theatresPosted}, theatresMatched=${theatresMatched}, ` +
            `activeMovies=${activeMovies}, showtimesPosted=${showtimesPosted}, ` +
            `showtimesUpserted=${showtimesUpserted}, errors=${JSON.stringify(responseErrors)}`
        );
      }
    }
  } catch (err) {
    console.error(
      "[scrape] POST to /api/ingest failed:",
      err instanceof Error ? err.message : err
    );
    ingestFailed = shouldFailRun({
      postFailed: true,
      errors: [],
      theatresPosted,
      showtimesPosted,
      dryRun: DRY_RUN,
    });
  }

  const allErrored = results.every((r) => r.error);
  process.exit(allErrored || ingestFailed ? 1 : 0);
}

// Only run main() when this file is executed directly (the production
// entrypoint), not when it's imported — e.g. by tests importing the pure
// helpers above — which would otherwise launch a real browser as a side
// effect of import.
const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((err) => {
    console.error("[scrape] fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
