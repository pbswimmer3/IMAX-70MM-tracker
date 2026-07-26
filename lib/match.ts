import type { NormalizedShowtime } from "./adapters/types";

interface MovieMatchers {
  amc?: {
    attributeCodes?: string[];
    movieIds?: string[];
    titlePattern?: string;
  };
  regal?: {
    hoCodes?: string[];
    titlePattern?: string;
  };
  [key: string]: unknown;
}

interface MatchableMovie {
  matchers: unknown;
  chain?: string;
}

// Returns true when the given matchers can never match a showtime for ANY
// chain, per the exact conditions matchesMovie tests below: for every chain
// key present (amc, regal) there is neither a non-empty id list (movieIds
// for amc, hoCodes for regal) nor a non-empty titlePattern. An empty/missing/
// malformed matchers value is also inert. Deliberately mirrors matchesMovie's
// blind spot: attributeCodes is never read there, so its presence alone must
// never count as "usable" here either — that mismatch is what let the /movies
// UI's default template silently match nothing.
export function isInertMatchers(matchers: unknown): boolean {
  if (typeof matchers !== "object" || matchers === null || Array.isArray(matchers)) {
    return true;
  }
  const m = matchers as Record<string, unknown>;
  const chains: Array<{ key: string; idKey: string }> = [
    { key: "amc", idKey: "movieIds" },
    { key: "regal", idKey: "hoCodes" },
  ];

  for (const { key, idKey } of chains) {
    const chainMatchers = m[key];
    if (typeof chainMatchers !== "object" || chainMatchers === null || Array.isArray(chainMatchers)) {
      continue;
    }
    const cm = chainMatchers as Record<string, unknown>;

    const idList = cm[idKey];
    if (Array.isArray(idList) && idList.length > 0) return false;

    const titlePattern = cm.titlePattern;
    if (typeof titlePattern === "string" && titlePattern.length > 0) return false;
  }

  return true;
}

export function matchesMovie(
  showtime: NormalizedShowtime,
  movie: MatchableMovie,
  chain: string
): boolean {
  if (!showtime.is70mm) return false;

  const matchers = (movie.matchers ?? {}) as MovieMatchers;
  const chainMatchers = matchers[chain.toLowerCase()] as
    | MovieMatchers["amc"]
    | MovieMatchers["regal"]
    | undefined;

  if (!chainMatchers) return false;

  const idList =
    chain.toLowerCase() === "amc"
      ? (chainMatchers as MovieMatchers["amc"])?.movieIds
      : (chainMatchers as MovieMatchers["regal"])?.hoCodes;

  if (
    Array.isArray(idList) &&
    showtime.movieExternalId &&
    idList.includes(showtime.movieExternalId)
  ) {
    return true;
  }

  const titlePattern = chainMatchers.titlePattern;
  if (typeof titlePattern === "string" && titlePattern.length > 0) {
    const pattern = titlePattern.toLowerCase();
    const title = (showtime.movieTitle ?? "").toLowerCase();
    if (title.includes(pattern)) return true;
  }

  return false;
}
