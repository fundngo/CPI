// AI extraction for credit reports and bank statements.
//
// Pipeline: pdf-parse text → (garbled / image-only?) → pdftoppm page images →
// Claude → JSON. Every step that can lose data (text cap, page cap, output
// cut off by max_tokens) adds a human-readable warning instead of failing
// silently, so the consultant knows to double-check the review screen.

import Anthropic from "@anthropic-ai/sdk";
// pdf-parse v2 exports a PDFParse class with .getText(). A static import works
// in both dev (tsx, ESM) and the production CJS bundle; the old `require()`
// call crashed `npm run dev` because `require` doesn't exist in ES modules.
import { PDFParse } from "pdf-parse";
import { renderPdfToImages, countPdfPages } from "./pdfVision";
import type { ChildTables } from "./storage";
import {
  lateBucketCounts,
  resolveMonthsSinceLate,
  validScore,
  formatBureauScores,
  midScore,
} from "@shared/creditLogic";

// Configurable via env so the model can be changed without a code change.
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
// Optional effort override (low | medium | high | xhigh | max). Only sent when
// set, because older models reject the parameter.
const CLAUDE_EFFORT = (process.env.CLAUDE_EFFORT || "").trim().toLowerCase();
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
// Streaming lets us allow a large output budget without HTTP timeouts.
const MAX_OUTPUT_TOKENS = Number(process.env.CLAUDE_MAX_TOKENS) || 64000;
// ~600k characters ≈ 150k tokens: plenty for a long tri-bureau report.
const MAX_TEXT_CHARS = 600_000;
// Vision fallback page budget (each page is one image block).
const VISION_MAX_PAGES = Math.max(1, Math.min(100, Number(process.env.VISION_MAX_PAGES) || 40));
// Keep the request well under the API's 32MB limit.
const VISION_MAX_BYTES = 20 * 1024 * 1024;


export type ExtractionResult = {
  parsed: any;
  method: "text" | "vision";
  warnings: string[];
};

// Detect encoded/garbled PDF text. Funding Suite credit reports and other
// PDFs with custom CID-encoded fonts produce text where pdf-parse returns
// glyph-index codepoints, not real letters. If we fed that to the LLM it
// would hallucinate plausible-but-wrong tradelines. Bail out instead.
function looksGarbled(text: string): boolean {
  if (!text) return true;
  const sample = text.slice(0, 8000);
  const total = sample.length;
  if (total < 200) return false;
  let asciiLetter = 0;
  let weird = 0;
  for (let i = 0; i < total; i++) {
    const c = sample.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) asciiLetter++;
    else if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) weird++;
    else if (c >= 0x80 && c <= 0x9f) weird++;
    else if (c >= 0xe000 && c <= 0xf8ff) weird++;
  }
  const letterRatio = asciiLetter / total;
  const weirdRatio = weird / total;
  return letterRatio < 0.20 || weirdRatio > 0.15;
}

async function extractPdfText(base64: string): Promise<{ text?: string; error?: string; truncated?: boolean }> {
  const cleaned = base64.includes(",") ? base64.split(",")[1] : base64;
  try {
    const pdfBuffer = Buffer.from(cleaned, "base64");
    const parser = new PDFParse({ data: pdfBuffer });
    const result = await parser.getText();
    let pdfText = "";
    if (typeof result?.text === "string") {
      pdfText = result.text.trim();
    } else if (Array.isArray(result?.pages)) {
      pdfText = result.pages.map((p: any) => p.text || "").join("\n").trim();
    }
    await parser.destroy?.();
    if (!pdfText || pdfText.length < 50) {
      return { error: "This PDF has no readable text. It may be a scanned image — please try a text-based PDF or enter manually." };
    }
    if (looksGarbled(pdfText)) {
      return { error: "This PDF uses encoded fonts that can't be read as text (common in Funding Suite mortgage reports and some MyFICO exports). Please enter the data manually or upload a different PDF export." };
    }
    const truncated = pdfText.length > MAX_TEXT_CHARS;
    if (truncated) pdfText = pdfText.slice(0, MAX_TEXT_CHARS);
    return { text: pdfText, truncated };
  } catch (err: any) {
    console.error("PDF parse error:", err);
    return { error: "Could not read this PDF. It may be image-only (scanned), password-protected, or corrupted." };
  }
}

// Attempt to repair JSON that was truncated mid-array/object by Claude max_tokens.
// Strategy: walk the string, track string/escape/bracket state, then trim back to
// the last complete element and auto-close open arrays/objects.
function repairTruncatedJson(input: string): string {
  let depth: string[] = []; // stack of '{' or '['
  let inString = false;
  let escape = false;
  let lastSafe = -1; // index after the last complete top-level-ish element
  let lastSafeDepth: string[] = [];
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{" || ch === "[") { depth.push(ch); continue; }
    if (ch === "}" || ch === "]") { depth.pop(); continue; }
    if (ch === "," && depth.length > 0) {
      // safe truncation point inside the innermost container
      lastSafe = i;
      lastSafeDepth = [...depth];
    }
  }
  let trimmed = lastSafe > 0 ? input.slice(0, lastSafe) : input;
  let closingDepth = lastSafe > 0 ? lastSafeDepth : depth;
  // close any open containers
  for (let i = closingDepth.length - 1; i >= 0; i--) {
    trimmed += closingDepth[i] === "{" ? "}" : "]";
  }
  return trimmed;
}

/** Strip fences, parse, fall back to the outermost {...}, then truncation repair. */
function parseModelJson(text: string): { value: any; repaired: boolean } {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return { value: JSON.parse(stripped), repaired: false };
  } catch {}
  const match = stripped.match(/\{[\s\S]*\}/);
  const candidate = match ? match[0] : stripped;
  try {
    return { value: JSON.parse(candidate), repaired: false };
  } catch (firstErr: any) {
    try {
      return { value: JSON.parse(repairTruncatedJson(candidate)), repaired: true };
    } catch {
      throw new Error("Could not parse extracted JSON: " + (firstErr?.message || "unknown error"));
    }
  }
}

let anthropic: Anthropic | null = null;
function client(): Anthropic {
  if (!anthropic) anthropic = new Anthropic();
  return anthropic;
}

/** One Claude call that must return a JSON object. */
async function claudeJson(
  systemPrompt: string,
  content: Anthropic.ContentBlockParam[],
  warnings: string[],
): Promise<any> {
  const params: any = {
    model: CLAUDE_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: systemPrompt,
    messages: [{ role: "user", content }],
  };
  if (EFFORTS.has(CLAUDE_EFFORT)) params.output_config = { effort: CLAUDE_EFFORT };

  const message = await client().messages.stream(params).finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error("The AI declined to process this document. Please enter the data manually.");
  }
  const text = (message.content || [])
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("The AI returned no data for this document.");

  const { value, repaired } = parseModelJson(text);
  if (message.stop_reason === "max_tokens" || repaired) {
    warnings.push(
      "The AI's answer was cut off before it finished, so some accounts or derogatory items may be missing. Compare the counts against the report before saving.",
    );
  }
  return value;
}

/**
 * Text path first (fast, cheap). If the PDF is image-only or uses encoded
 * fonts, render the pages and use vision instead.
 */
async function extractFromPdf(
  base64: string,
  systemPrompt: string,
  userTextTemplate: (pdfText: string) => string,
  visionInstruction: string,
): Promise<ExtractionResult> {
  const warnings: string[] = [];
  const { text: pdfText, error, truncated } = await extractPdfText(base64);
  if (pdfText && !error) {
    if (truncated) {
      warnings.push(
        `This report is very long; only the first ${MAX_TEXT_CHARS.toLocaleString()} characters were read. Accounts near the end may be missing.`,
      );
    }
    const parsed = await claudeJson(systemPrompt, [{ type: "text", text: userTextTemplate(pdfText) }], warnings);
    return { parsed, method: "text", warnings };
  }

  console.log(`[extract] text path failed (${error || "no text"}), falling back to vision`);
  let pages;
  try {
    pages = await renderPdfToImages(base64, { maxPages: VISION_MAX_PAGES, maxTotalBytes: VISION_MAX_BYTES });
  } catch (e: any) {
    console.error("[extract] PDF render failed:", e);
    throw new Error(`Could not render this PDF for image reading: ${e?.message || "unknown error"}. ${error || ""}`.trim());
  }
  if (!pages.length) throw new Error("This PDF has no pages to read.");

  const totalPages = await countPdfPages(base64).catch(() => null);
  if (totalPages != null && totalPages > pages.length) {
    warnings.push(
      `This PDF has ${totalPages} pages but only the first ${pages.length} were read (image mode). Accounts on later pages may be missing.`,
    );
  }
  console.log(`[extract] rendered ${pages.length}${totalPages ? `/${totalPages}` : ""} page(s) for vision`);

  const content: Anthropic.ContentBlockParam[] = [{ type: "text", text: visionInstruction }];
  for (const p of pages) {
    content.push({ type: "image", source: { type: "base64", media_type: p.mediaType, data: p.base64 } });
  }
  try {
    const parsed = await claudeJson(systemPrompt, content, warnings);
    return { parsed, method: "vision", warnings };
  } catch (e: any) {
    console.error("[extract] vision call failed:", e);
    throw new Error(`Image-based extraction failed: ${e?.message || "unknown error"}`);
  }
}

function todayLine(): string {
  return `Today's date is ${new Date().toISOString().slice(0, 10)}. Use it for withinTwelveMonths, monthsSinceLate, and average account age.`;
}

const CREDIT_REPORT_SCHEMA_PROMPT = `You are a JSON-only API. Output ONLY valid JSON matching this exact schema (no markdown, no commentary, no explanation):
{
  "name": string,    // see CRITICAL NAME/ADDRESS RULES below
  "address": string, // see CRITICAL NAME/ADDRESS RULES below
  "phone": string|null,
  "email": string|null,
  "creditScore": number|null,        // see SCORE RULES below — pick the MIDDLE of the 3 bureau scores (mortgage-qualifying mid-score)
  "creditScoreSource": string|null,   // which bureau the chosen score came from ("Equifax"|"Experian"|"TransUnion")
  "bureauScores": { "equifax": number|null, "experian": number|null, "transunion": number|null },
  "creditCards": [
    { "cardName": string, "issuer": string, "creditLimit": number, "currentBalance": number, "minimumPayment": number|null, "paymentDueDate": string|null, "accountStatus": "Current"|"Past Due"|"Closed"|"Charged Off" }
  ],
  "chargeOffs": [
    { "creditor": string, "accountType": string, "originalAmount": number, "balance": number, "openedDate": string, "closedDate": string }
  ],
  "collections": [
    { "creditor": string, "originalCreditor": string, "balance": number, "reportedDate": string }
  ],
  "latePayments": [
    { "creditor": string, "accountType": string, "status": "Open"|"Closed", "mostRecentLateDate": string, "lateHistory": string, "withinTwelveMonths": boolean, "monthsSinceLate": number|null }
  ],
  "repossessions": [
    { "creditor": string, "accountType": string, "originalAmount": number, "balance": number, "openedDate": string, "repoDate": string, "status": string }
  ],
  "publicRecords": [
    { "recordType": "Bankruptcy"|"Judgment"|"Foreclosure"|"Tax Lien"|"Other", "courtOrAgency": string, "referenceNumber": string, "amount": number, "status": string, "filedDate": string }
  ],
  "totalAccountsCount": number,
  "oldestAccount": { "creditor": string, "year": number },
  "newestAccount": { "creditor": string, "year": number },
  "avgAccountAge": { "years": number, "months": number }
}
SCORE RULES:
- If the report shows scores from multiple bureaus (Equifax / Experian / TransUnion — common in tri-merge mortgage reports), populate ALL THREE in bureauScores.
- For the top-level "creditScore" + "creditScoreSource", pick the MIDDLE of the three (mortgage mid-score). If only 2 scores are shown, pick the lower. If only 1 is shown, use it.
- Score sources commonly appear under headers like "Credit Scores", "FICO Score", "Score Summary", or in a 3-column block at the top of the report.

CRITICAL CHARGE-OFF vs COLLECTION RULES (most common source of errors):
- A "paid-collection" / "collection" / "placed for collection" / "in collection" → goes in collections[], NOT chargeOffs[].
- A "charge-off" / "charged off" / "paid-chargeOff" → goes in chargeOffs[], NOT collections[].
- The status field on each tradeline (e.g. "paid-collection" vs "paid-chargeOff") is the source of truth — read it carefully on each account.
- Funding Suite mortgage reports list these in the tradeline table with an explicit account status column. NEVER guess based on creditor name alone (e.g. "Cap One" can be either — read its actual status).
- An account can only appear in ONE of chargeOffs[] or collections[] — never both. The same physical account is not double-counted.
- chargeOffsCount and collectionsCount on the final summary equal the array lengths — getting the bucket wrong shifts a count by 1.

AVG ACCOUNT AGE RULES:
- avgAccountAge.years and avgAccountAge.months together describe ONE duration (e.g. 5 years 7 months).
- months MUST be in 0–11 range. NEVER use 0 months as a default — if you don't know the exact months, estimate from the opened dates of the tradelines you see.
- If the report doesn't show any opened dates at all, set BOTH years and months to 0 (signals unknown).
- Otherwise compute: average across all tradelines of (today - openedDate) in months, then split into years + remaining months.

Also include a comprehensive flat list named allAccounts containing EVERY tradeline you see, in this format:
"allAccounts": [
  { "creditor": string, "accountType": "Credit Card"|"Auto Loan"|"Mortgage"|"Student Loan"|"Personal Loan"|"Collection"|"Charge-Off"|"Repossession"|"Public Record"|"Other", "status": "Open"|"Closed"|"Paid"|"Current"|"Past Due"|"Charged Off"|"In Collection"|string, "openedYear": number|null, "balance": number|null }
]

CRITICAL NAME/ADDRESS RULES:
- Pull "name" and "address" ONLY from the consumer's Personal Information / Personal Profile / Consumer Information / Personal Identifying Information / Consumer Statement section at the top of the report — the section that lists the real consumer's full name, partial DOB, address history, and masked SSN.
- For "address", use the address marked Current, Primary, or Most Recent. If multiple addresses are listed, pick the one with the most recent reported / on-file date. Format as "STREET, CITY ST ZIP".
- IGNORE all placeholder, sample, instructional, or merge-template text. Specifically, NEVER use any of these values: FOLLOW ME, FOLLOW ME LATER, SAMPLE, EXAMPLE, TEST, JOHN DOE, JANE DOE, John A. Sample, JOHN Q PUBLIC, JANE SMITH (when on a template), SOMEWHERE STREET, SOMEPLACE, ANYTOWN, ANYWHERE, 12345 (alone), 99999, 123 MAIN ST, 123 ANY STREET, YOUR NAME, YOUR ADDRESS, CLIENT NAME, [NAME], [ADDRESS], CONSUMER NAME, N/A, NONE.
- NEVER pull the name or address from a dispute-letter template, sample letter, instructions panel, marketing footer, or any section showing how a future letter would look. Those sections often contain placeholder text like FOLLOW ME and SOMEWHERE STREET.
- NEVER pull the name or address from a creditor's mailing block (e.g. an address shown next to ENHANCED RECOVERY, MIDLAND CREDIT, etc.) — those are creditor addresses, not the consumer's.
- If the report has no recognizable consumer Personal Information section, OR the only candidates match the placeholders above, return EMPTY STRING ("") for that field rather than guessing.

Extract from the attached credit report PDF. Dates use "YYYY-MM" format. lateHistory is a short summary like "1x60d 1x90d" or "24x90d" describing how many times late and severity. withinTwelveMonths is true if the most recent late payment occurred within the last 12 months from today (today's date is given in the user message). monthsSinceLate is the integer number of months between the most recent late date and today (use null if unknown — never guess). repossessions includes vehicle or asset repossessions — list each one. publicRecords includes bankruptcies, judgments, foreclosures, tax liens; recordType MUST be one of the listed values. For totalAccountsCount: count EVERY tradeline listed on the report — open AND closed/paid accounts, revolving + installment (auto, mortgage, student) + collections + charge-offs + public records. The value MUST equal allAccounts.length. List ALL accounts in their proper category arrays — credit cards (revolving) go in creditCards; auto loans, mortgages, student loans, personal loans go ONLY if they appear as charge-off/repossession/collection — but EVERY account regardless of type must appear in allAccounts. If a field is unknown, use null (or empty string for required strings, 0 for numbers, [] for arrays). For accountStatus, use "Current" by default. Return ONLY the JSON object.`;

const BANK_STATEMENT_SCHEMA_PROMPT = `You are a JSON-only API. Output ONLY valid JSON matching this exact schema (no markdown, no commentary):
{
  "bankName": string|null,
  "accountHolderName": string|null,
  "accounts": [
    { "accountType": "Checking"|"Savings"|"Money Market"|"CD"|"Retirement"|"Business Checking"|"Business Savings"|"Other", "accountName": string, "lastFourDigits": string|null, "endingBalance": number|null, "averageBalance": number|null, "openedDate": string|null }
  ],
  "statementPeriod": { "start": string|null, "end": string|null },
  "hasSavings": boolean,
  "hasRetirement": boolean,
  "isBusinessAccount": boolean,
  "businessClassificationReason": string,
  "totalDeposits": number|null,
  "totalWithdrawals": number|null,
  "notes": string|null
}
Extract from the attached bank statement text. Dates use "YYYY-MM" format. hasSavings = true if any account is Savings/Money Market/CD. hasRetirement = true only if a retirement/401k/IRA account is shown.

CRITICAL FOR isBusinessAccount: classify based on the ACCOUNT HOLDER NAME on the statement, NOT the product name. Set isBusinessAccount=true ONLY if the account holder name contains a business entity suffix (LLC, L.L.C., Inc, Inc., Corp, Corporation, Ltd, LP, LLP, PLLC, Company, Co., Holdings, Trust, Foundation, DBA, or is clearly a non-person entity name). If the account holder is a natural person's name (e.g. "JOHN A SMITH", "TAMARA GUERRERO"), set isBusinessAccount=false EVEN IF the product is called "Business Checking" or similar. Some people open business-named products for personal use — the holder name is the ground truth. In businessClassificationReason, briefly explain (e.g. "holder name is 'TAMARA GUERRERO' — a personal name" or "holder name contains 'LLC'").

If unknown, use null/empty/0 as appropriate. Return ONLY the JSON object.`;

export async function extractCreditReport(base64: string): Promise<ExtractionResult> {
  const result = await extractFromPdf(
    base64,
    CREDIT_REPORT_SCHEMA_PROMPT,
    (pdfText) =>
      `${todayLine()}\n\nExtract client data from this credit report text. Return ONLY the JSON object per the schema.\n\n--- CREDIT REPORT TEXT ---\n${pdfText}\n--- END ---`,
    `${todayLine()}\n\nExtract client data from this credit report. The pages are attached as images — read the text directly from the images. Return ONLY the JSON object per the schema, no markdown, no commentary.`,
  );
  result.parsed = normalizeCreditReport(result.parsed);
  return result;
}

export async function extractBankStatement(base64: string): Promise<ExtractionResult> {
  const result = await extractFromPdf(
    base64,
    BANK_STATEMENT_SCHEMA_PROMPT,
    (pdfText) =>
      `Extract bank account info from this statement text. Return ONLY the JSON object per the schema.\n\n--- BANK STATEMENT TEXT ---\n${pdfText}\n--- END ---`,
    `Extract bank account info from this statement. The pages are attached as images — read the text directly from the images. Return ONLY the JSON object per the schema, no markdown, no commentary.`,
  );
  if (!result.parsed || typeof result.parsed !== "object") result.parsed = {};
  return result;
}

// Server-side safety net: strip out known placeholder values that some
// credit-report templates contain (dispute-letter samples, instructional
// panels). If the LLM still grabbed one of these despite the prompt,
// blank it out so the user can fill it in via Edit instead of seeing junk.
export const NAME_PLACEHOLDER_PATTERNS: RegExp[] = [
  /\bfollow\s*me( later)?\b/i,
  /\b(sample|example|test)\b/i,
  /\bjohn\s+doe\b/i,
  /\bjane\s+doe\b/i,
  /\bjohn\s+q\.?\s+public\b/i,
  /\byour\s+name\b/i,
  /\bclient\s+name\b/i,
  /\bconsumer\s+name\b/i,
  /^\s*\[?(name|address)\]?\s*$/i,
  /^\s*n\/?a\s*$/i,
  /^\s*none\s*$/i,
];
export const ADDR_PLACEHOLDER_PATTERNS: RegExp[] = [
  /\bsomewhere\s+(street|st|drive|dr|ave|avenue|road|rd)\b/i,
  /\bsomeplace\b/i,
  /\banytown\b/i,
  /\banywhere\b/i,
  /\byour\s+address\b/i,
  /\b123\s+main\s+st(reet)?\b/i,
  /\b123\s+any\s+(street|st)\b/i,
  /^\s*\[?address\]?\s*$/i,
  /\b12345\b.*\b(somewhere|someplace|anytown|anywhere)\b/i,
  /^\s*n\/?a\s*$/i,
];
export function sanitizePlaceholder(value: string | null | undefined, patterns: RegExp[]): string {
  if (!value) return "";
  const v = String(value).trim();
  if (!v) return "";
  for (const p of patterns) if (p.test(v)) return "";
  return v;
}

// Best-effort: derive a real name from the uploaded PDF's filename when
// the LLM gave us a placeholder. We use the consultant's own naming
// convention: "<First Last> - CR (MM-DD-YY).pdf" or "<First Last> CR ...".
export function deriveNameFromFilename(fileName?: string): string {
  if (!fileName) return "";
  let base = fileName.replace(/\.[a-zA-Z0-9]+$/, ""); // strip extension
  // Strip anything from " - CR" / " CR " / parens onward
  base = base.split(/\s+-\s+CR\b|\s+CR\b|\(/i)[0];
  base = base.replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
  // Must look like a person's name: 2-4 words, alpha-only
  if (!/^[A-Za-z][A-Za-z.'\- ]{2,60}$/.test(base)) return "";
  const parts = base.split(" ").filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return "";
  // Title-case each part
  return parts
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

const arr = (v: any): any[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
const num = (v: any): number => {
  const n = Number(typeof v === "string" ? v.replace(/[$,\s]/g, "") : v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: any): string => (v == null ? "" : String(v).trim());
const CARD_STATUSES = new Set(["Current", "Past Due", "Closed", "Charged Off"]);
const RECORD_TYPES = new Set(["Bankruptcy", "Judgment", "Foreclosure", "Tax Lien", "Other"]);

/**
 * Coerce the model's JSON into the shapes the app stores. Invalid scores
 * become null, numbers are parsed, enums are clamped, and placeholder names
 * and addresses are blanked.
 */
export function normalizeCreditReport(raw: any): any {
  const p = raw && typeof raw === "object" ? raw : {};
  const b = p.bureauScores && typeof p.bureauScores === "object" ? p.bureauScores : {};
  const bureauScores = {
    equifax: validScore(b.equifax),
    experian: validScore(b.experian),
    transunion: validScore(b.transunion),
  };
  const today = new Date();
  return {
    ...p,
    name: sanitizePlaceholder(p.name, NAME_PLACEHOLDER_PATTERNS),
    address: sanitizePlaceholder(p.address, ADDR_PLACEHOLDER_PATTERNS),
    phone: str(p.phone) || null,
    email: str(p.email) || null,
    bureauScores,
    creditScore: validScore(p.creditScore) ?? midScore([bureauScores.equifax, bureauScores.experian, bureauScores.transunion]),
    creditCards: arr(p.creditCards).map((c) => ({
      cardName: str(c.cardName),
      issuer: str(c.issuer),
      creditLimit: num(c.creditLimit),
      currentBalance: num(c.currentBalance),
      minimumPayment: c.minimumPayment != null ? num(c.minimumPayment) : null,
      paymentDueDate: str(c.paymentDueDate) || null,
      accountStatus: CARD_STATUSES.has(c.accountStatus) ? c.accountStatus : "Current",
    })),
    chargeOffs: arr(p.chargeOffs).map((c) => ({
      creditor: str(c.creditor),
      accountType: str(c.accountType),
      originalAmount: num(c.originalAmount),
      balance: num(c.balance),
      openedDate: str(c.openedDate),
      closedDate: str(c.closedDate),
    })),
    collections: arr(p.collections).map((c) => ({
      creditor: str(c.creditor),
      originalCreditor: str(c.originalCreditor),
      balance: num(c.balance),
      reportedDate: str(c.reportedDate),
    })),
    latePayments: arr(p.latePayments).map((l) => {
      const months = resolveMonthsSinceLate(l, today);
      return {
        creditor: str(l.creditor),
        accountType: str(l.accountType),
        status: l.status === "Closed" ? "Closed" : "Open",
        mostRecentLateDate: str(l.mostRecentLateDate),
        lateHistory: str(l.lateHistory),
        // Recompute from the date when we have one; the model's flag is the fallback.
        withinTwelveMonths: months != null ? months <= 12 : !!l.withinTwelveMonths,
        monthsSinceLate: months ?? 0,
      };
    }),
    repossessions: arr(p.repossessions).map((r) => ({
      creditor: str(r.creditor),
      accountType: str(r.accountType),
      originalAmount: num(r.originalAmount),
      balance: num(r.balance),
      openedDate: str(r.openedDate),
      repoDate: str(r.repoDate),
      status: str(r.status),
    })),
    publicRecords: arr(p.publicRecords).map((r) => ({
      recordType: RECORD_TYPES.has(r.recordType) ? r.recordType : "Other",
      courtOrAgency: str(r.courtOrAgency),
      referenceNumber: str(r.referenceNumber),
      amount: num(r.amount),
      status: str(r.status),
      filedDate: str(r.filedDate),
    })),
    allAccounts: arr(p.allAccounts),
    totalAccountsCount: Math.max(0, Math.round(num(p.totalAccountsCount))),
    oldestAccount: p.oldestAccount && typeof p.oldestAccount === "object"
      ? { creditor: str(p.oldestAccount.creditor), year: Math.round(num(p.oldestAccount.year)) }
      : null,
    newestAccount: p.newestAccount && typeof p.newestAccount === "object"
      ? { creditor: str(p.newestAccount.creditor), year: Math.round(num(p.newestAccount.year)) }
      : null,
    avgAccountAge: p.avgAccountAge && typeof p.avgAccountAge === "object"
      ? {
          years: Math.max(0, Math.round(num(p.avgAccountAge.years))),
          months: Math.min(11, Math.max(0, Math.round(num(p.avgAccountAge.months)))),
        }
      : null,
  };
}

/** Utilization over open cards only (closed / charged-off excluded), as a whole %. */
function openCardUtilization(cards: any[]): number | null {
  const open = cards.filter((c) => c.accountStatus !== "Closed" && c.accountStatus !== "Charged Off");
  const limit = open.reduce((s, c) => s + num(c.creditLimit), 0);
  const bal = open.reduce((s, c) => s + num(c.currentBalance), 0);
  return limit > 0 ? Math.round((bal / limit) * 100) : null;
}

/** Client-row fields derived from a (normalized) credit-report extraction. */
export function buildCreditReportPatch(parsed: any): Record<string, any> {
  // Normalizing is idempotent, so this is safe for already-normalized input.
  const p = normalizeCreditReport(parsed);
  const patch: Record<string, any> = {};
  const b = p.bureauScores || {};
  if (b.equifax != null) patch.equifaxScore = b.equifax;
  if (b.experian != null) patch.experianScore = b.experian;
  if (b.transunion != null) patch.transunionScore = b.transunion;
  const tri = formatBureauScores(b.equifax, b.experian, b.transunion);
  if (tri) {
    patch.recentCreditReport = tri;
  } else if (p.creditScore != null) {
    patch.recentCreditReport = p.creditScoreSource ? `${p.creditScore} (${p.creditScoreSource})` : String(p.creditScore);
  }
  patch.totalAccountsCount = p.totalAccountsCount || 0;
  if (p.oldestAccount) {
    patch.oldestAccountCreditor = p.oldestAccount.creditor || "";
    patch.oldestAccountYear = p.oldestAccount.year || 0;
  }
  if (p.newestAccount) {
    patch.newestAccountCreditor = p.newestAccount.creditor || "";
    patch.newestAccountYear = p.newestAccount.year || 0;
  }
  if (p.avgAccountAge) {
    patch.avgAccountAgeYears = p.avgAccountAge.years || 0;
    patch.avgAccountAgeMonths = p.avgAccountAge.months || 0;
  }
  patch.chargeOffsCount = (p.chargeOffs || []).length;
  patch.collectionsCount = (p.collections || []).length;
  patch.repossessionsCount = (p.repossessions || []).length;
  patch.publicRecordsCount = (p.publicRecords || []).length;
  const counts = lateBucketCounts(p.latePayments || []);
  patch.latePaymentsCount = counts.total;
  patch.latePaymentsWithin12moCount = counts.within12;
  patch.latePayments12to24moCount = counts.between12And24;
  patch.latePaymentsOlder24moCount = counts.over24;
  const util = openCardUtilization(p.creditCards || []);
  if (util != null) patch.creditUtilization = util;
  patch.creditAnalysisDate = new Date().toISOString().slice(0, 10);
  return patch;
}

/** Client-row fields derived from a bank-statement extraction. */
export function buildBankPatch(parsed: any) {
  const accounts = arr(parsed?.accounts);
  const isBiz = !!parsed?.isBusinessAccount;
  const patch: Record<string, any> = {};
  if (isBiz) {
    patch.hasBusinessAccounts = true;
    patch.businessAccountsList = accounts.map((a) => a.accountName || a.accountType).filter(Boolean).join(", ");
  } else {
    patch.numBankAccounts = accounts.length;
    patch.bankAccountsList = accounts
      .map((a) => `${a.accountName || a.accountType}${a.lastFourDigits ? ` (…${a.lastFourDigits})` : ""}`)
      .join(", ");
    if (typeof parsed?.hasSavings === "boolean") patch.hasSavings = parsed.hasSavings;
    if (typeof parsed?.hasRetirement === "boolean") patch.hasRetirement401k = parsed.hasRetirement;
  }
  return { patch, isBiz, accounts };
}

/** DB rows for each child table, from a credit-report extraction (normalized here). */
export function toChildTables(parsed: any): Required<ChildTables> {
  const p = normalizeCreditReport(parsed);
  return {
    creditCards: p.creditCards.map((c: any) => ({
      cardName: c.cardName || "Card",
      issuer: c.issuer,
      creditLimit: c.creditLimit,
      currentBalance: c.currentBalance,
      minimumPayment: c.minimumPayment ?? 0,
      paymentDueDate: c.paymentDueDate || "",
      accountStatus: c.accountStatus,
      notes: "",
    })),
    chargeOffs: p.chargeOffs.map((c: any) => ({ ...c, notes: "" })),
    collections: p.collections.map((c: any) => ({ ...c, notes: "" })),
    latePayments: p.latePayments,
    repossessions: p.repossessions.map((r: any) => ({ ...r, notes: "" })),
    publicRecords: p.publicRecords.map((r: any) => ({ ...r, notes: "" })),
  };
}
