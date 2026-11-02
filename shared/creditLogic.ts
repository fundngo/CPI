// Pure credit-report helpers shared by the server (extraction → DB summary
// counts) and the client (profile tables, PDF export, New Client review).
// Keeping one implementation means the summary counts saved on the client row
// always agree with the tables the user sees.

export type LateBucket = "within12" | "12to24" | "over24" | "unknown";

export type LatePaymentLike = {
  mostRecentLateDate?: string | null;
  withinTwelveMonths?: boolean | null;
  monthsSinceLate?: number | null;
};

/**
 * Parse "YYYY-MM", "YYYY-MM-DD", "MM/YYYY" or "MM/DD/YYYY" into {year, month}
 * (month 1–12). Returns null for anything else.
 */
export function parseYearMonth(value: string | null | undefined): { year: number; month: number } | null {
  if (!value) return null;
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (m) return validYm(Number(m[1]), Number(m[2]));
  m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return validYm(Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})$/);
  if (m) return validYm(Number(m[2]), Number(m[1]));
  return null;
}

function validYm(year: number, month: number) {
  if (!Number.isFinite(year) || year < 1900 || year > 2200) return null;
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  return { year, month };
}

/** Whole months from a YYYY-MM style date to `today`. Null if unparseable or in the future. */
export function monthsSince(dateStr: string | null | undefined, today: Date = new Date()): number | null {
  const ym = parseYearMonth(dateStr);
  if (!ym) return null;
  const diff = (today.getFullYear() - ym.year) * 12 + (today.getMonth() + 1 - ym.month);
  return diff >= 0 ? diff : null;
}

/**
 * Best estimate of months since the most recent late payment.
 * Priority: the reported date (computed against today) → the model's
 * monthsSinceLate when it is a positive number. 0/null without a date is
 * treated as unknown, because older extractions used 0 to mean "unknown".
 */
export function resolveMonthsSinceLate(lp: LatePaymentLike, today: Date = new Date()): number | null {
  const fromDate = monthsSince(lp.mostRecentLateDate, today);
  if (fromDate != null) return fromDate;
  const n = Number(lp.monthsSinceLate);
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  return null;
}

/** Put a late payment in exactly one recency bucket. */
export function lateBucket(lp: LatePaymentLike, today: Date = new Date()): LateBucket {
  const months = resolveMonthsSinceLate(lp, today);
  if (months != null) {
    if (months <= 12) return "within12";
    if (months <= 24) return "12to24";
    return "over24";
  }
  // No usable date: fall back to the model's boolean flag.
  if (lp.withinTwelveMonths) return "within12";
  return "unknown";
}

export function bucketLatePayments<T extends LatePaymentLike>(
  list: T[],
  today: Date = new Date(),
): Record<LateBucket, T[]> {
  const out: Record<LateBucket, T[]> = { within12: [], "12to24": [], over24: [], unknown: [] };
  for (const lp of list || []) out[lateBucket(lp, today)].push(lp);
  return out;
}

export function lateBucketCounts(list: LatePaymentLike[], today: Date = new Date()) {
  const b = bucketLatePayments(list, today);
  return {
    total: (list || []).length,
    within12: b.within12.length,
    between12And24: b["12to24"].length,
    over24: b.over24.length,
    unknown: b.unknown.length,
  };
}

/** A real FICO/Vantage score is 300–850. Anything else becomes null. */
export function validScore(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 300 || n > 850) return null;
  return n;
}

/**
 * Mortgage-style mid score: middle of 3, lower of 2, the only one of 1.
 * Returns null when no valid score is on file.
 */
export function midScore(scores: Array<number | null | undefined>): number | null {
  const valid = scores.map(validScore).filter((n): n is number => n != null).sort((a, b) => a - b);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];
  if (valid.length === 2) return valid[0];
  return valid[Math.floor(valid.length / 2)];
}

/** "Equifax 702 • Experian 691 • TransUnion 708" (only the scores present). */
export function formatBureauScores(eq: unknown, ex: unknown, tu: unknown): string {
  const parts: string[] = [];
  const e = validScore(eq);
  const x = validScore(ex);
  const t = validScore(tu);
  if (e != null) parts.push(`Equifax ${e}`);
  if (x != null) parts.push(`Experian ${x}`);
  if (t != null) parts.push(`TransUnion ${t}`);
  return parts.join(" • ");
}
