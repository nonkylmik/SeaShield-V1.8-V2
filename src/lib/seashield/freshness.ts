const HAS_TIMEZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** Parses an API timestamp (UTC when it has no zone); null when it is missing or invalid. */
export function parseApiTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const iso = value.trim().replace(" ", "T");
  const parsed = Date.parse(HAS_TIMEZONE.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * The instant communication ages are measured against: the real clock for backend data, which carries real
 * timestamps, and the simulated clock only for the offline fixtures, which are dated on it.
 */
export function freshnessNow(
  dataSource: "seed" | "backend",
  simulatedNow: number,
  realNow: number,
): number {
  return dataSource === "backend" ? realNow : simulatedNow;
}
