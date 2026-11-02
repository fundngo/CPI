// Credit-report helpers shared by the server (extraction/mapping), the UI, and
// the PDF export, so every surface buckets and formats data the same way.

import { CARD_STATUSES, PUBLIC_RECORD_TYPES } from "./schema";
import type { CardStatus, PublicRecordType } from "./schema";

export type LateBucket = "within12" | "12to24" | "over24";

/**
 * Bucket a late payment by recency.
 * - withinTwelveMonths flag wins (it is what the bureau/LLM reported).
 * - otherwise monthsSinceLate > 24 → over 24 months, else 12–24 months.
 * Every late payment lands in exactly one bucket.
 */
export function lateBucket(lp: { withinTwelveMonths?: boolean | null; monthsSinceLate?: number | null }): LateBucket {
  if (lp.withinTwelveMonths) return "within12";
  const m = Number(lp.monthsSinceLate) || 0;
  if (m > 24) return "over24";
  return "12to24";
}

export function splitLatePayments<T extends { withinTwelveMonths?: boolean | null; monthsSinceLate?: number | null }>(
  list: T[],
): Record<LateBucket, T[]> {
  const out: Record<LateBucket, T[]> = { within12: [], "12to24": [], over24: [] };
  for (const lp of list) out[lateBucket(lp)].push(lp);
  return out;
}

export type BureauScores = {
  equifax?: number | null;
  experian?: number | null;
  transunion?: number | null;
};

/** "Equifax 702 • Experian 691 • TransUnion 708" (only the bureaus present). */
export function formatBureauScores(s: BureauScores, sep = " • "): string {
  const parts: string[] = [];
  if (s.equifax != null) parts.push(`Equifax ${s.equifax}`);
  if (s.experian != null) parts.push(`Experian ${s.experian}`);
  if (s.transunion != null) parts.push(`TransUnion ${s.transunion}`);
  return parts.join(sep);
}

/** Return a valid FICO-range integer (300–850) or null. */
export function validScore(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 300 || n > 850) return null;
  return n;
}

/**
 * Parse legacy free-text like "747 (TransUnion)" or
 * "Equifax 702, Experian 691, TransUnion 708" into bureau scores.
 */
export function parseBureauScores(text: string | null | undefined): BureauScores {
  const s = String(text || "");
  const out: BureauScores = {};
  const eq = s.match(/equifax\s*[:\-]?\s*(\d{3})/i);
  const ex = s.match(/experian\s*[:\-]?\s*(\d{3})/i);
  const tu = s.match(/trans\s*union\s*[:\-]?\s*(\d{3})/i);
  if (eq) out.equifax = validScore(eq[1]);
  if (ex) out.experian = validScore(ex[1]);
  if (tu) out.transunion = validScore(tu[1]);
  const re = /(\d{3})\s*\(\s*(equifax|experian|trans\s*union)\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const score = validScore(m[1]);
    const bureau = m[2].toLowerCase().replace(/\s+/g, "");
    if (bureau === "equifax" && out.equifax == null) out.equifax = score;
    if (bureau === "experian" && out.experian == null) out.experian = score;
    if (bureau === "transunion" && out.transunion == null) out.transunion = score;
  }
  return out;
}

/** Normalize an average age so months is always 0–11. */
export function normalizeAge(years: unknown, months: unknown): { years: number; months: number } {
  const y = Math.max(0, Math.floor(Number(years) || 0));
  const m = Math.max(0, Math.floor(Number(months) || 0));
  const total = y * 12 + m;
  return { years: Math.floor(total / 12), months: total % 12 };
}

export function coerceCardStatus(v: unknown): CardStatus {
  const s = String(v || "").trim().toLowerCase();
  const hit = CARD_STATUSES.find((c) => c.toLowerCase() === s);
  if (hit) return hit;
  if (s.includes("charge")) return "Charged Off";
  if (s.includes("past") || s.includes("late") || s.includes("delinq")) return "Past Due";
  if (s.includes("closed")) return "Closed";
  return "Current";
}

export function coercePublicRecordType(v: unknown): PublicRecordType {
  const s = String(v || "").trim().toLowerCase();
  const hit = PUBLIC_RECORD_TYPES.find((t) => t.toLowerCase() === s);
  if (hit) return hit;
  if (s.includes("bankrupt")) return "Bankruptcy";
  if (s.includes("judg")) return "Judgment";
  if (s.includes("foreclos")) return "Foreclosure";
  if (s.includes("lien")) return "Tax Lien";
  return "Other";
}

export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}
