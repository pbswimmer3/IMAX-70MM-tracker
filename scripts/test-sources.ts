/**
 * Reality-check the two data sources before relying on them.
 *
 *   npm run test:sources                 # tests AMC key (movies endpoint) + Regal
 *   npm run test:sources -- 610          # also tests AMC showtimes for theatre id 610
 *
 * Run it on your own machine (needs AMC_VENDOR_KEY in env). NOTE: a PASS here
 * proves the AMC key works everywhere (it's key-based, IP-agnostic), but Regal
 * sits behind Cloudflare and may judge your home IP differently from Vercel's
 * datacenter IPs — so a Regal PASS locally is encouraging, not a guarantee for
 * production. The definitive Regal test is hitting /api/cron/poll once deployed.
 */
const AMC_KEY = process.env.AMC_VENDOR_KEY ?? "";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function amcDate(d: Date) {
  return `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`;
}
function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
function interpret(status: number) {
  if (status === 200) return "OK ✓";
  if (status === 401) return "401 — key missing/invalid or not activated";
  if (status === 403) return "403 — blocked or key not authorized for this resource";
  if (status === 404) return "404 — wrong id/endpoint (API itself is alive)";
  return `${status}`;
}

async function testAmcKey() {
  console.log("\n[AMC] key check — GET /v2/movies/80679 (The Odyssey)");
  if (!AMC_KEY) return console.log("  SKIP — AMC_VENDOR_KEY not set");
  try {
    const res = await fetch("https://api.amctheatres.com/v2/movies/80679", {
      headers: { Accept: "application/json", "X-AMC-Vendor-Key": AMC_KEY, "User-Agent": BROWSER_UA },
    });
    console.log(`  HTTP ${res.status} — ${interpret(res.status)}`);
    if (res.ok) {
      const m = (await res.json()) as { name?: string };
      console.log(`  → movie: ${m.name ?? "(no name field)"}`);
    } else {
      console.log(`  → ${(await res.text()).slice(0, 200).replace(/\s+/g, " ")}`);
    }
  } catch (e) {
    console.log(`  ERROR — ${e instanceof Error ? e.message : e}`);
  }
}

async function testAmcShowtimes(theatreId: string) {
  const date = amcDate(new Date());
  console.log(`\n[AMC] showtimes — GET /v2/theatres/${theatreId}/showtimes/${date}`);
  if (!AMC_KEY) return console.log("  SKIP — AMC_VENDOR_KEY not set");
  try {
    const res = await fetch(
      `https://api.amctheatres.com/v2/theatres/${theatreId}/showtimes/${date}`,
      { headers: { Accept: "application/json", "X-AMC-Vendor-Key": AMC_KEY, "User-Agent": BROWSER_UA } }
    );
    console.log(`  HTTP ${res.status} — ${interpret(res.status)}`);
    if (res.ok) {
      const d = (await res.json()) as { _embedded?: { showtimes?: unknown[] }; theatreName?: string };
      console.log(
        `  → theatre: ${d.theatreName ?? "?"}, showtimes today: ${d._embedded?.showtimes?.length ?? 0}`
      );
    }
  } catch (e) {
    console.log(`  ERROR — ${e instanceof Error ? e.message : e}`);
  }
}

async function testRegal() {
  const date = isoDate(new Date());
  const id = "0347"; // Regal Hacienda Crossings
  console.log(`\n[REGAL] showtimes — getShowtimes?theatres=${id}&date=${date} (Hacienda Crossings)`);
  try {
    const res = await fetch(
      `https://www.regmovies.com/api/getShowtimes?theatres=${id}&date=${date}&hoCode=&ignoreCache=false&moviesOnly=false`,
      { headers: { Accept: "application/json", "User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9" } }
    );
    const ct = res.headers.get("content-type") ?? "";
    console.log(`  HTTP ${res.status} — content-type: ${ct}`);
    const text = await res.text();
    if (ct.includes("application/json")) {
      try {
        const j = JSON.parse(text);
        const topKeys = Array.isArray(j) ? "(array)" : Object.keys(j).join(", ");
        console.log(`  OK ✓ JSON parsed. top-level keys: ${topKeys}`);
        console.log(`  → paste the first ~800 chars below to me so I can lock the parser:`);
        console.log("  " + text.slice(0, 800).replace(/\n/g, " "));
      } catch {
        console.log("  Got 200 but body isn't valid JSON. First 200 chars:");
        console.log("  " + text.slice(0, 200).replace(/\s+/g, " "));
      }
    } else {
      console.log("  Not JSON — likely a Cloudflare challenge/HTML. First 200 chars:");
      console.log("  " + text.slice(0, 200).replace(/\s+/g, " "));
    }
  } catch (e) {
    console.log(`  ERROR — ${e instanceof Error ? e.message : e}`);
  }
}

async function main() {
  const amcId = process.argv.slice(2).find((a) => /^\d+$/.test(a));
  await testAmcKey();
  if (amcId) await testAmcShowtimes(amcId);
  else console.log("\n[AMC] showtimes — SKIP (pass a theatre id: npm run test:sources -- <id>)");
  await testRegal();
  console.log("");
}

main();
