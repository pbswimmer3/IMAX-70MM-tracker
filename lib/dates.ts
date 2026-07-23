// UTC calendar-date key YYYY-MM-DD for a Date.
export function utcDateKey(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Given the set of already-known drop date-keys and the incoming date-keys,
// return the incoming keys that are new (not in existing), de-duped, sorted asc.
export function newDropDates(existing: Set<string>, incoming: string[]): string[] {
  const fresh = new Set<string>();
  for (const key of incoming) {
    if (!existing.has(key)) fresh.add(key);
  }
  return Array.from(fresh).sort();
}
