/**
 * Resolve AMC numeric theatreIds for the AMC theatres in lib/theatres.ts.
 *
 * AMC's public site uses name slugs, but api.amctheatres.com needs the numeric
 * theatreId. This script uses your vendor key to look each AMC theatre up by
 * name and prints the id to paste into lib/theatres.ts (replacing the *_TODO
 * placeholders). Then re-run `npm run db:seed`.
 *
 * Usage: AMC_VENDOR_KEY=... npm run resolve:amc
 */
import { THEATRES } from "../lib/theatres";

const VENDOR_KEY = process.env.AMC_VENDOR_KEY;
const HEADERS: Record<string, string> = {
  Accept: "application/json",
  "X-AMC-Vendor-Key": VENDOR_KEY ?? "",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

interface AmcTheatre {
  id?: number | string;
  name?: string;
  slug?: string;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function searchByName(name: string): Promise<AmcTheatre[]> {
  const url = `https://api.amctheatres.com/v2/theatres?name=${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`name search HTTP ${res.status}`);
  const data = (await res.json()) as { _embedded?: { theatres?: AmcTheatre[] } };
  return data._embedded?.theatres ?? [];
}

async function fetchAllTheatres(): Promise<AmcTheatre[]> {
  // Fallback: page through the full theatre list and match locally.
  const all: AmcTheatre[] = [];
  let url: string | undefined = "https://api.amctheatres.com/v2/theatres?page-size=100&page-number=1";
  let guard = 0;
  while (url && guard < 20) {
    const res: Response = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`list HTTP ${res.status}`);
    const data = (await res.json()) as {
      _embedded?: { theatres?: AmcTheatre[] };
      _links?: { next?: { href?: string } };
    };
    all.push(...(data._embedded?.theatres ?? []));
    url = data._links?.next?.href;
    guard += 1;
  }
  return all;
}

function bestMatch(target: string, candidates: AmcTheatre[]): AmcTheatre | undefined {
  const t = norm(target);
  // exact-ish first: candidate name contained in target or vice versa
  return (
    candidates.find((c) => c.name && (norm(c.name) === t)) ||
    candidates.find((c) => c.name && (t.includes(norm(c.name)) || norm(c.name).includes(t)))
  );
}

async function main() {
  if (!VENDOR_KEY) {
    console.error("AMC_VENDOR_KEY is not set. Get one at developers.amctheatres.com, then re-run.");
    process.exit(1);
  }

  const amcTheatres = THEATRES.filter((t) => t.chain === "AMC");
  let fallbackList: AmcTheatre[] | null = null;

  console.log("\nPaste these into lib/theatres.ts, then run `npm run db:seed`:\n");
  for (const t of amcTheatres) {
    // Use a short, distinctive query (drop the " & IMAX" suffix and city noise).
    const query = t.name.replace(/&.*/, "").trim();
    let match: AmcTheatre | undefined;
    try {
      match = bestMatch(t.name, await searchByName(query));
    } catch {
      /* fall through to full-list scan */
    }
    if (!match) {
      try {
        fallbackList = fallbackList ?? (await fetchAllTheatres());
        match = bestMatch(t.name, fallbackList);
      } catch (err) {
        console.error(`  ! ${t.name}: lookup failed —`, err instanceof Error ? err.message : err);
        continue;
      }
    }
    if (match?.id !== undefined) {
      console.log(`  ${t.name}\n    externalId: "${match.id}",  // ${match.slug ?? "(matched by name)"}`);
    } else {
      console.log(`  ${t.name}\n    externalId: "???",  // no match — check name manually`);
    }
  }
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
