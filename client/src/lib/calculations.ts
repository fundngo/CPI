import type { Client, CreditCard, ClientWithDetails } from "@shared/schema";

export type RevenueStatus = "None" | "Starting" | "Growing" | "Strong";
export type UtilStatus = "Excellent" | "Good" | "Caution" | "Critical";

export function personalBankingStrength(client: Pick<Client, "numBankAccounts" | "hasSavings" | "hasRetirement401k" | "personalBankingStrengthOverride">): number {
  if (client.personalBankingStrengthOverride != null) return clamp(client.personalBankingStrengthOverride, 0, 100);
  let s = 0;
  const n = client.numBankAccounts ?? 0;
  if (n >= 4) s += 80;
  else if (n === 3) s += 60;
  else if (n === 2) s += 40;
  else if (n === 1) s += 20;
  if (client.hasSavings) s += 10;
  if (client.hasRetirement401k) s += 10;
  return Math.min(100, s);
}

export function businessBankingStrength(client: Pick<Client, "activeLLC" | "hasBusinessAccounts" | "generatingRevenue" | "hasBusinessProducts" | "gettingOffersInMail" | "businessBankingStrengthOverride">): number {
  if (client.businessBankingStrengthOverride != null) return clamp(client.businessBankingStrengthOverride, 0, 100);
  let s = 0;
  if (client.activeLLC) s += 20;
  if (client.hasBusinessAccounts) s += 20;
  if (client.generatingRevenue) s += 30;
  if (client.hasBusinessProducts) s += 15;
  if (client.gettingOffersInMail) s += 15;
  return Math.min(100, s);
}

export function strengthLabel(score: number): "Weak" | "Fair" | "Strong" {
  if (score >= 70) return "Strong";
  if (score >= 40) return "Fair";
  return "Weak";
}

export function overallUtilization(cards: CreditCard[]): number {
  const activeCards = cards.filter(c => c.accountStatus !== "Closed" && c.accountStatus !== "Charged Off");
  const totalLimit = activeCards.reduce((s, c) => s + (c.creditLimit || 0), 0);
  const totalBal = activeCards.reduce((s, c) => s + (c.currentBalance || 0), 0);
  if (totalLimit <= 0) return 0;
  return (totalBal / totalLimit) * 100;
}

export function cardUtilization(card: CreditCard): number {
  if (!card.creditLimit || card.creditLimit <= 0) return 0;
  return (card.currentBalance / card.creditLimit) * 100;
}

export function utilizationScore(utilPct: number): number {
  if (utilPct < 10) return 100;
  if (utilPct < 20) return 85;
  if (utilPct < 30) return 70;
  if (utilPct < 50) return 50;
  if (utilPct < 75) return 25;
  return 0;
}

export function utilizationStatus(utilPct: number): UtilStatus {
  if (utilPct < 10) return "Excellent";
  if (utilPct < 30) return "Good";
  if (utilPct < 50) return "Caution";
  return "Critical";
}

export function utilizationColor(utilPct: number): string {
  if (utilPct < 10) return "hsl(120 60% 45%)"; // brand green
  if (utilPct < 30) return "hsl(120 60% 45%)";
  if (utilPct < 50) return "hsl(38 92% 50%)"; // amber
  if (utilPct < 75) return "hsl(20 90% 50%)"; // orange
  return "hsl(0 72% 51%)"; // red
}

// ---- CPI Sheet helpers (color buckets + paydown targets) ----
export type UtilBucket = "green" | "yellow" | "red";

/** Bucket utilization using the user's CPI thresholds (≤15 / ≤30 / >30). */
export function utilBucket(utilPct: number): UtilBucket {
  if (utilPct <= 15) return "green";
  if (utilPct <= 30) return "yellow";
  return "red";
}

/** Tailwind-style RGB hex for each bucket (used by both DOM and PDF). */
export function bucketHex(bucket: UtilBucket): string {
  if (bucket === "green") return "#16a34a"; // green-600
  if (bucket === "yellow") return "#d97706"; // amber-600
  return "#dc2626"; // red-600
}

/** Light tint hex for row backgrounds. */
export function bucketTintHex(bucket: UtilBucket): string {
  if (bucket === "green") return "#ecfdf5"; // emerald-50
  if (bucket === "yellow") return "#fffbeb"; // amber-50
  return "#fef2f2"; // red-50
}

/** Max balance to be at or under {pct}% of limit. */
export function targetBalanceAt(creditLimit: number, pct: number): number {
  const lim = Math.max(0, creditLimit || 0);
  return Math.round((lim * pct) / 100);
}

/** $ that must be paid down to get to {pct}%. 0 if already at/under. */
export function paydownTo(currentBalance: number, creditLimit: number, pct: number): number {
  const target = targetBalanceAt(creditLimit, pct);
  const owed = Math.max(0, (currentBalance || 0) - target);
  return Math.round(owed);
}

export function businessRevenueScore(monthly: number): number {
  if (monthly >= 50000) return 100;
  if (monthly >= 20000) return 85;
  if (monthly >= 5000) return 60;
  if (monthly >= 1) return 30;
  return 0;
}

export function businessRevenueStatus(monthly: number): RevenueStatus {
  if (monthly >= 20000) return "Strong";
  if (monthly >= 5000) return "Growing";
  if (monthly >= 1) return "Starting";
  return "None";
}

export function parseMissingDocs(json: string): string[] {
  try {
    const parsed = JSON.parse(json || "[]");
    return Array.isArray(parsed) ? parsed.filter(s => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export function fundingReadinessScore(client: ClientWithDetails): number {
  if (client.fundingReadinessScoreOverride != null) return clamp(client.fundingReadinessScoreOverride, 0, 100);
  const util = overallUtilization(client.creditCards);
  const pb = personalBankingStrength(client);
  const bb = businessBankingStrength(client);
  const us = utilizationScore(util);
  const br = businessRevenueScore(client.monthlyRevenue);
  const base = 0.25 * pb + 0.25 * bb + 0.25 * us + 0.25 * br;
  const missing = parseMissingDocs(client.missingDocuments);
  const deduction = Math.min(20, missing.length * 5);
  return clamp(Math.round(base - deduction), 0, 100);
}

export function readinessLabel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: "Funding Ready", color: "hsl(120 60% 45%)" };
  if (score >= 50) return { label: "Almost Ready", color: "hsl(38 92% 50%)" };
  return { label: "Not Ready", color: "hsl(0 72% 51%)" };
}

export function autoRecommendedSteps(client: ClientWithDetails): string[] {
  const steps: string[] = [];
  const util = overallUtilization(client.creditCards);
  const missing = parseMissingDocs(client.missingDocuments);
  const score = fundingReadinessScore(client);

  if (util > 50) steps.push("URGENT: High utilization — prioritize paying down credit card balances immediately.");
  else if (util > 30) steps.push("Pay down credit cards to bring overall utilization under 30%.");

  if (!client.activeLLC) steps.push("Form an LLC to begin building business credit separately from personal.");
  if (client.activeLLC && !client.hasBusinessAccounts) steps.push("Open dedicated business bank accounts in the LLC's name.");
  if (client.hasBusinessAccounts && !client.generatingRevenue) steps.push("Begin generating business revenue (any amount) and run it through the business accounts.");
  if (client.generatingRevenue && client.monthlyRevenue < 5000) steps.push("Grow monthly revenue to $5,000+ to unlock stronger funding access.");

  if (missing.length > 0) steps.push(`Collect missing documents: ${missing.join(", ")}.`);

  if (score >= 80) steps.push("Client is funding ready — begin submitting business credit and funding applications.");

  return steps;
}

export type Flag = { kind: "red" | "amber" | "green"; text: string };

export function autoFlags(client: ClientWithDetails): Flag[] {
  const flags: Flag[] = [];
  const util = overallUtilization(client.creditCards);
  const missing = parseMissingDocs(client.missingDocuments);
  const score = fundingReadinessScore(client);

  if (util > 50) flags.push({ kind: "red", text: "High credit utilization (>50%)" });
  else if (util >= 30) flags.push({ kind: "amber", text: "Moderate utilization (30–50%)" });

  if (client.lastUpdated) {
    const last = new Date(client.lastUpdated).getTime();
    const days = (Date.now() - last) / (1000 * 60 * 60 * 24);
    if (days > 30) flags.push({ kind: "red", text: "Stale data — last updated over 30 days ago" });
  }

  if (missing.length > 0) flags.push({ kind: "amber", text: `Missing documents: ${missing.length} item${missing.length === 1 ? "" : "s"}` });

  if (score >= 80) flags.push({ kind: "green", text: "Funding ready" });

  return flags;
}

export function totalCreditLimit(cards: CreditCard[]): number {
  return cards.filter(c => c.accountStatus !== "Closed" && c.accountStatus !== "Charged Off")
    .reduce((s, c) => s + (c.creditLimit || 0), 0);
}

export function totalBalance(cards: CreditCard[]): number {
  return cards.filter(c => c.accountStatus !== "Closed" && c.accountStatus !== "Charged Off")
    .reduce((s, c) => s + (c.currentBalance || 0), 0);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
}

export function fmtPct(n: number, digits = 1): string {
  return `${(n || 0).toFixed(digits)}%`;
}

export function fmtDate(d: string | Date): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return String(d);
  }
}
