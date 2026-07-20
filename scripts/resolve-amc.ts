/**
 * Help fill the AMC numeric theatreIds in lib/theatres.ts.
 *
 * AMC's public site + catalog endpoints sit behind a WAF and the "list/search
 * theatres" catalog API is a SEPARATE grant from the free Showtimes tier — so a
 * keyed request to it commonly returns HTTP 403. This script therefore does two
 * things:
 *
 *   1) `npm run resolve:amc`            → try a name search (verbose), and if it's
 *                                          blocked, print the browser recipe.
 *   2) `npm run resolve:amc -- 3210 …`  → VERIFY one or more candidate ids you
 *                                          grabbed from the browser, using your
 *                                          Showtimes key (which IS authorized for
 *                                          /theatres/{id}/showtimes/{date}). Prints
 *                                          the theatre name so you can confirm.
 *
 * Browser recipe (never blocked): open the theatre's /showtimes page, DevTools →
 * Network → filter "api.amctheatres" → the request URL is
 * .../v2/theatres/<NNNN>/showtimes/... ; <NNNN> is the id.
 */
import { THEATRES } from "../lib/theatres";

const VENDOR_KEY = process.env.AMC_VENDOR_KEY;
const HEADERS: Record<string, string> = {
  Accept: "application/json",
  "X-AMC-Vendor-Key": VENDOR_KEY ?? "",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

function mdyToday(): string {
  const d = new Date();
  return `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`;
}

async function verifyId(id: string): Promise<void> {
  // Showtimes endpoint is covered by the free tier; a 2xx (even with zero
  // showtimes) confirms the id is real and authorized for your key.
  const url = `https://api.amctheatres.com/v2/theatres/${id}/showtimes/${mdyToday()}`;
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (res.status === 401) {
      console.log(`  ${id}: HTTP 401 — AMC_VENDOR_KEY missing/invalid.`);
      return;
    }
    if (!res.ok) {
      console.log(`  ${id}: HTTP ${res.status} — not a valid/authorized theatre id.`);
      return;
    }
    const data = (await res.json()) as {
      _embedded?: { showtimes?: Array<{ theatreName?: string }> };
      theatreName?: string;
    };
    const name =
      data.theatreName ?? data._embedded?.showtimes?.[0]?.theatreName ?? "(name not in payload)";
    console.log(`  ${id}: OK ✓  ${name}  — paste this id into lib/theatres.ts`);
  } catch (err) {
    console.log(`  ${id}: request failed — ${err instanceof Error ? err.message : err}`);
  }
}

async function trySearch(name: string): Promise<void> {
  const query = name.replace(/&.*/, "").trim();
  const url = `https://api.amctheatres.com/v2/theatres?name=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 160).replace(/\s+/g, " ");
      console.log(`  ${name}\n    search HTTP ${res.status} — ${body || "(no body)"}`);
      return;
    }
    const data = (await res.json()) as {
      _embedded?: { theatres?: Array<{ id?: number | string; name?: string; slug?: string }> };
    };
    const list = data._embedded?.theatres ?? [];
    const hit = list.find((t) => (t.name ?? "").toLowerCase().includes(query.toLowerCase())) ?? list[0];
    if (hit?.id !== undefined) {
      console.log(`  ${name}\n    externalId: "${hit.id}",  // ${hit.slug ?? hit.name ?? ""}`);
    } else {
      console.log(`  ${name}\n    search returned no match.`);
    }
  } catch (err) {
    console.log(`  ${name}\n    search failed — ${err instanceof Error ? err.message : err}`);
  }
}

async function main() {
  if (!VENDOR_KEY) {
    console.error("AMC_VENDOR_KEY is not set. Get one at developers.amctheatres.com, then re-run.");
    process.exit(1);
  }

  const ids = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
  if (ids.length > 0) {
    console.log("\nVerifying candidate AMC theatre ids against the Showtimes API:\n");
    for (const id of ids) await verifyId(id);
    console.log("");
    return;
  }

  console.log("\nAttempting AMC theatre name search (often 403 on the free Showtimes tier):\n");
  for (const t of THEATRES.filter((t) => t.chain === "AMC")) await trySearch(t.name);

  console.log(
    [
      "",
      "If the searches above were blocked (403), the catalog/search API isn't in your",
      "key's grant. Get each id straight from your browser instead:",
      "  1) Open the theatre's /showtimes page on amctheatres.com",
      "  2) DevTools → Network → filter \"api.amctheatres\" → reload",
      "  3) The request URL is  .../v2/theatres/<NNNN>/showtimes/...  — <NNNN> is the id",
      "Then verify it here:  npm run resolve:amc -- <NNNN> <NNNN>",
      "",
    ].join("\n")
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
