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
