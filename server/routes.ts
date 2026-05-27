import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import { storage, seedIfEmpty } from "./storage";
import {
  insertClientSchema,
  updateClientSchema,
  insertCreditCardSchema,
  updateCreditCardSchema,
  insertUploadedFileSchema,
} from "@shared/schema";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
// pdf-parse v2 exports a PDFParse class with .getText()
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PDFParse } = require("pdf-parse");

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Increase body size for base64 file uploads
  // (already set in index.ts via express.json default; bump via middleware)

  await seedIfEmpty().catch((e) => console.error("Seed error:", e));

  // ====== Shared helpers for PDF extraction ======

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

  async function extractPdfText(base64: string): Promise<{ text?: string; error?: string }> {
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
      const MAX_TEXT = 180000;
      if (pdfText.length > MAX_TEXT) pdfText = pdfText.slice(0, MAX_TEXT);
      return { text: pdfText };
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

  async function claudeJson(systemPrompt: string, userText: string): Promise<any> {
    const client = new Anthropic();
    const message = await client.messages.create({
      model: "claude_sonnet_4_5" as any,
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{ role: "user", content: userText }],
    });
    const text = (message.content || [])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n")
      .trim();
    const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    // First try direct parse
    try {
      return JSON.parse(stripped);
    } catch {}
    // Try extracting the outermost {...}
    const match = stripped.match(/\{[\s\S]*\}/);
    const candidate = match ? match[0] : stripped;
    try {
      return JSON.parse(candidate);
    } catch (firstErr: any) {
      // Truncation repair fallback
      try {
        const repaired = repairTruncatedJson(candidate);
        const parsed = JSON.parse(repaired);
        console.warn("claudeJson: parsed after truncation repair");
        return parsed;
      } catch {
        throw new Error(
          "Could not parse extracted JSON: " + (firstErr?.message || "unknown error")
        );
      }
    }
  }

  const CREDIT_REPORT_SCHEMA_PROMPT = `You are a JSON-only API. Output ONLY valid JSON matching this exact schema (no markdown, no commentary, no explanation):
{
  "name": string,    // see CRITICAL NAME/ADDRESS RULES below
  "address": string, // see CRITICAL NAME/ADDRESS RULES below
  "phone": string|null,
  "email": string|null,
  "creditScore": number|null,
  "creditScoreSource": string|null,
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
    { "creditor": string, "accountType": string, "status": "Open"|"Closed", "mostRecentLateDate": string, "lateHistory": string, "withinTwelveMonths": boolean, "monthsSinceLate": number }
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

Extract from the attached credit report PDF. Dates use "YYYY-MM" format. lateHistory is a short summary like "1x60d 1x90d" or "24x90d" describing how many times late and severity. withinTwelveMonths is true if the most recent late payment occurred within the last 12 months from today. monthsSinceLate is the integer number of months between the most recent late date and today (use 0 if unknown). repossessions includes vehicle or asset repossessions — list each one. publicRecords includes bankruptcies, judgments, foreclosures, tax liens; recordType MUST be one of the listed values. For totalAccountsCount: count EVERY tradeline listed on the report — open AND closed/paid accounts, revolving + installment (auto, mortgage, student) + collections + charge-offs + public records. The value MUST equal allAccounts.length. List ALL accounts in their proper category arrays — credit cards (revolving) go in creditCards; auto loans, mortgages, student loans, personal loans go ONLY if they appear as charge-off/repossession/collection — but EVERY account regardless of type must appear in allAccounts. If a field is unknown, use null (or empty string for required strings, 0 for numbers, [] for arrays). For accountStatus, use "Current" by default. Return ONLY the JSON object.`;

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

  // ====== Endpoints ======

  // Server-side safety net: strip out known placeholder values that some
  // credit-report templates contain (dispute-letter samples, instructional
  // panels). If the LLM still grabbed one of these despite the prompt,
  // blank it out so the user can fill it in via Edit instead of seeing junk.
  const NAME_PLACEHOLDER_PATTERNS: RegExp[] = [
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
  const ADDR_PLACEHOLDER_PATTERNS: RegExp[] = [
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
  function sanitizePlaceholder(value: string | null | undefined, patterns: RegExp[]): string {
    if (!value) return "";
    const v = String(value).trim();
    if (!v) return "";
    for (const p of patterns) if (p.test(v)) return "";
    return v;
  }

  // Best-effort: derive a real name from the uploaded PDF's filename when
  // the LLM gave us a placeholder. We use the consultant's own naming
  // convention: "<First Last> - CR (MM-DD-YY).pdf" or "<First Last> CR ...".
  function deriveNameFromFilename(fileName?: string): string {
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

  // Extract client data from a credit-report PDF (used by Add Client flow)
  app.post("/api/extract-credit-report", async (req: Request, res: Response) => {
    try {
      const { fileBase64, fileName } = req.body as { fileBase64?: string; fileName?: string };
      if (!fileBase64) return res.status(400).json({ message: "Missing fileBase64" });
      const { text: pdfText, error } = await extractPdfText(fileBase64);
      if (error || !pdfText) return res.status(422).json({ message: error || "No text" });
      const parsed = await claudeJson(
        CREDIT_REPORT_SCHEMA_PROMPT,
        `Extract client data from this credit report text. Return ONLY the JSON object per the schema.\n\n--- CREDIT REPORT TEXT ---\n${pdfText}\n--- END ---`
      );
      // Strip known placeholders
      const cleanName = sanitizePlaceholder(parsed?.name, NAME_PLACEHOLDER_PATTERNS);
      const cleanAddress = sanitizePlaceholder(parsed?.address, ADDR_PLACEHOLDER_PATTERNS);
      // If name came back empty after stripping, try to derive from filename
      const fallbackName = cleanName || deriveNameFromFilename(fileName);
      parsed.name = fallbackName;
      parsed.address = cleanAddress;
      res.json({ extracted: parsed, fileName: fileName || "credit-report.pdf" });
    } catch (e: any) {
      console.error("Extract error:", e);
      res.status(500).json({ message: e?.message || "Extraction failed" });
    }
  });

  // ====== Field-label registry for the review modal ======
  const FIELD_LABELS: Record<string, { label: string; section: string; format?: "number" | "text" | "bool" | "money" | "percent" }> = {
    recentCreditReport: { label: "Credit Score", section: "Credit Report", format: "text" },
    totalAccountsCount: { label: "Accounts Found", section: "Credit Report", format: "number" },
    creditUtilization: { label: "Credit Utilization", section: "Credit Report", format: "percent" },
    chargeOffsCount: { label: "Charge-Offs", section: "Credit Report", format: "number" },
    collectionsCount: { label: "Collections", section: "Credit Report", format: "number" },
    repossessionsCount: { label: "Repossessions", section: "Credit Report", format: "number" },
    publicRecordsCount: { label: "Public Records", section: "Credit Report", format: "number" },
    latePaymentsCount: { label: "Late Payments (total)", section: "Credit Report", format: "number" },
    latePaymentsWithin12moCount: { label: "Late — within 12mo", section: "Credit Report", format: "number" },
    latePayments12to24moCount: { label: "Late — 12–24mo", section: "Credit Report", format: "number" },
    latePaymentsOlder24moCount: { label: "Late — over 24mo", section: "Credit Report", format: "number" },
    oldestAccountCreditor: { label: "Oldest Account Creditor", section: "Credit Report", format: "text" },
    oldestAccountYear: { label: "Oldest Account Year", section: "Credit Report", format: "number" },
    newestAccountCreditor: { label: "Newest Account Creditor", section: "Credit Report", format: "text" },
    newestAccountYear: { label: "Newest Account Year", section: "Credit Report", format: "number" },
    avgAccountAgeYears: { label: "Avg Account Age (years)", section: "Credit Report", format: "number" },
    avgAccountAgeMonths: { label: "Avg Account Age (months)", section: "Credit Report", format: "number" },
    creditAnalysisDate: { label: "Credit Analysis Date", section: "Credit Report", format: "text" },
    // Tables (treated as one row each in the review modal)
    __cards: { label: "Credit Cards (replace all)", section: "Credit Report", format: "text" },
    __chargeOffs: { label: "Charge-Offs (replace all)", section: "Credit Report", format: "text" },
    __collections: { label: "Collections (replace all)", section: "Credit Report", format: "text" },
    __latePayments: { label: "Late Payments (replace all)", section: "Credit Report", format: "text" },
    __repossessions: { label: "Repossessions (replace all)", section: "Credit Report", format: "text" },
    __publicRecords: { label: "Public Records (replace all)", section: "Credit Report", format: "text" },
    // Bank fields
    numBankAccounts: { label: "# Personal Bank Accounts", section: "Banking", format: "number" },
    bankAccountsList: { label: "Personal Bank Accounts", section: "Banking", format: "text" },
    hasSavings: { label: "Has Savings", section: "Banking", format: "bool" },
    hasRetirement401k: { label: "Has Retirement / 401k", section: "Banking", format: "bool" },
    hasBusinessAccounts: { label: "Has Business Accounts", section: "Banking", format: "bool" },
    businessAccountsList: { label: "Business Bank Accounts", section: "Banking", format: "text" },
  };

  // Build the credit-report patch + parsed payload
  async function buildCreditReportPatch(parsed: any) {
    const patch: any = {};
    if (parsed.creditScore != null && parsed.creditScoreSource) {
      patch.recentCreditReport = `${parsed.creditScore} (${parsed.creditScoreSource})`;
    } else if (parsed.creditScore != null) {
      patch.recentCreditReport = String(parsed.creditScore);
    }
    if (parsed.totalAccountsCount != null) patch.totalAccountsCount = Number(parsed.totalAccountsCount) || 0;
    if (parsed.oldestAccount) {
      patch.oldestAccountCreditor = parsed.oldestAccount.creditor || "";
      patch.oldestAccountYear = Number(parsed.oldestAccount.year) || 0;
    }
    if (parsed.newestAccount) {
      patch.newestAccountCreditor = parsed.newestAccount.creditor || "";
      patch.newestAccountYear = Number(parsed.newestAccount.year) || 0;
    }
    if (parsed.avgAccountAge) {
      patch.avgAccountAgeYears = Number(parsed.avgAccountAge.years) || 0;
      patch.avgAccountAgeMonths = Number(parsed.avgAccountAge.months) || 0;
    }
    patch.chargeOffsCount = (parsed.chargeOffs || []).length;
    patch.collectionsCount = (parsed.collections || []).length;
    patch.repossessionsCount = (parsed.repossessions || []).length;
    patch.publicRecordsCount = (parsed.publicRecords || []).length;
    const lp = (parsed.latePayments || []) as any[];
    patch.latePaymentsCount = lp.length;
    patch.latePaymentsWithin12moCount = lp.filter((l) => l.withinTwelveMonths || (l.monthsSinceLate != null && l.monthsSinceLate <= 12)).length;
    patch.latePayments12to24moCount = lp.filter((l) => l.monthsSinceLate != null && l.monthsSinceLate > 12 && l.monthsSinceLate <= 24).length;
    patch.latePaymentsOlder24moCount = lp.filter((l) => l.monthsSinceLate != null && l.monthsSinceLate > 24).length;
    const cards = (parsed.creditCards || []) as any[];
    const totalLimit = cards.reduce((s, c) => s + (Number(c.creditLimit) || 0), 0);
    const totalBal = cards.reduce((s, c) => s + (Number(c.currentBalance) || 0), 0);
    if (totalLimit > 0) patch.creditUtilization = Math.round((totalBal / totalLimit) * 100);
    patch.creditAnalysisDate = new Date().toISOString().slice(0, 10);
    return patch;
  }

  function buildBankPatch(parsed: any) {
    const accounts = (parsed.accounts || []) as any[];
    const isBiz = !!parsed.isBusinessAccount;
    const patch: any = {};
    if (isBiz) {
      patch.hasBusinessAccounts = true;
      patch.businessAccountsList = accounts.map((a) => a.accountName || a.accountType).filter(Boolean).join(", ");
    } else {
      patch.numBankAccounts = accounts.length;
      patch.bankAccountsList = accounts.map((a) => `${a.accountName || a.accountType}${a.lastFourDigits ? ` (…${a.lastFourDigits})` : ""}`).join(", ");
      if (typeof parsed.hasSavings === "boolean") patch.hasSavings = parsed.hasSavings;
      if (typeof parsed.hasRetirement === "boolean") patch.hasRetirement401k = parsed.hasRetirement;
    }
    return { patch, isBiz, accounts };
  }

  function diffPatch(current: any, patch: any) {
    // Return [{ key, label, section, format, currentValue, proposedValue, changed }]
    const out: any[] = [];
    for (const key of Object.keys(patch)) {
      const meta = FIELD_LABELS[key];
      if (!meta) continue;
      const cur = (current as any)[key];
      const next = patch[key];
      const changed = String(cur ?? "") !== String(next ?? "");
      out.push({ key, label: meta.label, section: meta.section, format: meta.format || "text", currentValue: cur, proposedValue: next, changed });
    }
    return out;
  }

  // PREVIEW: re-extract from latest files, return proposed changes without writing
  app.post("/api/clients/:id/preview-from-files", async (req: Request, res: Response) => {
    const clientId = Number(req.params.id);
    if (!Number.isFinite(clientId)) return res.status(400).json({ message: "Invalid id" });
    const client = await storage.getClient(clientId);
    if (!client) return res.status(404).json({ message: "Client not found" });

    const allFiles = client.files || [];
    const latestOf = (type: string) => {
      const list = allFiles.filter((f: any) => f.fileType === type);
      if (list.length === 0) return undefined;
      return list.sort((a: any, b: any) => (b.uploadedAt || "").localeCompare(a.uploadedAt || ""))[0];
    };
    const latestCreditReport = latestOf("credit_report");
    const latestBankStatement = latestOf("bank_statement");

    if (!latestCreditReport && !latestBankStatement) {
      return res.status(400).json({ message: "No credit report or bank statement uploaded yet. Upload a PDF first, then click Update again." });
    }

    const out: any = { errors: [], creditReport: null, bankStatement: null };

    if (latestCreditReport) {
      try {
        const fullFile = await storage.getFile(latestCreditReport.id);
        const base64 = (fullFile as any)?.base64Content;
        if (!base64) throw new Error("Credit report file has no content stored");
        const { text: pdfText, error } = await extractPdfText(base64);
        if (error || !pdfText) throw new Error(error || "No text in credit report PDF");
        const parsed = await claudeJson(
          CREDIT_REPORT_SCHEMA_PROMPT,
          `Extract client data from this credit report text. Return ONLY the JSON object per the schema.\n\n--- CREDIT REPORT TEXT ---\n${pdfText}\n--- END ---`
        );
        const patch = await buildCreditReportPatch(parsed);
        const fieldDiffs = diffPatch(client, patch);
        // Table-level diffs: just count comparisons
        const tableDiffs: any[] = [];
        const tableSpecs: Array<[string, string, any[], number]> = [
          ["__cards", "Credit Cards (replace all)", parsed.creditCards || [], (client as any).creditCards?.length || 0],
          ["__chargeOffs", "Charge-Offs (replace all)", parsed.chargeOffs || [], (client as any).chargeOffs?.length || 0],
          ["__collections", "Collections (replace all)", parsed.collections || [], (client as any).collections?.length || 0],
          ["__latePayments", "Late Payments (replace all)", parsed.latePayments || [], (client as any).latePayments?.length || 0],
          ["__repossessions", "Repossessions (replace all)", parsed.repossessions || [], (client as any).repossessions?.length || 0],
          ["__publicRecords", "Public Records (replace all)", parsed.publicRecords || [], (client as any).publicRecords?.length || 0],
        ];
        for (const [key, label, newList, currentCount] of tableSpecs) {
          tableDiffs.push({
            key, label, section: "Credit Report", format: "text",
            currentValue: `${currentCount} item${currentCount === 1 ? "" : "s"}`,
            proposedValue: `${newList.length} item${newList.length === 1 ? "" : "s"}`,
            changed: currentCount !== newList.length || newList.length > 0,
          });
        }
        out.creditReport = {
          fileName: latestCreditReport.fileName,
          fileId: latestCreditReport.id,
          diffs: [...fieldDiffs, ...tableDiffs],
          allAccounts: parsed.allAccounts || [],
          parsed, // store full parsed payload so apply doesn't re-run Claude
        };
      } catch (e: any) {
        console.error("Credit report preview error:", e);
        out.errors.push(`Credit report (${latestCreditReport.fileName}): ${e?.message || "failed"}`);
      }
    }

    if (latestBankStatement) {
      try {
        const fullFile = await storage.getFile(latestBankStatement.id);
        const base64 = (fullFile as any)?.base64Content;
        if (!base64) throw new Error("Bank statement file has no content stored");
        const { text: pdfText, error } = await extractPdfText(base64);
        if (error || !pdfText) throw new Error(error || "No text in bank statement PDF");
        const parsed = await claudeJson(
          BANK_STATEMENT_SCHEMA_PROMPT,
          `Extract bank account info from this statement text. Return ONLY the JSON object per the schema.\n\n--- BANK STATEMENT TEXT ---\n${pdfText}\n--- END ---`
        );
        const { patch, isBiz, accounts } = buildBankPatch(parsed);
        const diffs = diffPatch(client, patch);
        out.bankStatement = {
          fileName: latestBankStatement.fileName,
          fileId: latestBankStatement.id,
          accountHolderName: parsed.accountHolderName || null,
          bankName: parsed.bankName || null,
          isBusinessAccount: isBiz,
          businessClassificationReason: parsed.businessClassificationReason || null,
          accountsFound: accounts.length,
          accounts,
          diffs,
          parsed,
        };
      } catch (e: any) {
        console.error("Bank statement preview error:", e);
        out.errors.push(`Bank statement (${latestBankStatement.fileName}): ${e?.message || "failed"}`);
      }
    }

    res.json(out);
  });

  // APPLY: receive selected fields + parsed payloads, write to DB
  app.post("/api/clients/:id/apply-from-files", async (req: Request, res: Response) => {
    const clientId = Number(req.params.id);
    if (!Number.isFinite(clientId)) return res.status(400).json({ message: "Invalid id" });
    const client = await storage.getClient(clientId);
    if (!client) return res.status(404).json({ message: "Client not found" });

    const { acceptedKeys, creditReportParsed, bankStatementParsed } = req.body as {
      acceptedKeys: string[];
      creditReportParsed?: any;
      bankStatementParsed?: any;
    };
    if (!Array.isArray(acceptedKeys)) return res.status(400).json({ message: "acceptedKeys required" });
    const accept = new Set(acceptedKeys);

    // Credit report scalar patch
    if (creditReportParsed) {
      const fullPatch = await buildCreditReportPatch(creditReportParsed);
      const filtered: any = {};
      for (const k of Object.keys(fullPatch)) if (accept.has(k)) filtered[k] = fullPatch[k];
      if (Object.keys(filtered).length > 0) await storage.updateClient(clientId, filtered);

      // Table replacements: only if user accepted that table
      if (accept.has("__cards")) {
        await storage.replaceCards(clientId, (creditReportParsed.creditCards || []).map((c: any) => ({
          cardName: c.cardName || "", issuer: c.issuer || "",
          creditLimit: Number(c.creditLimit) || 0, currentBalance: Number(c.currentBalance) || 0,
          minimumPayment: c.minimumPayment != null ? Number(c.minimumPayment) : null,
          paymentDueDate: c.paymentDueDate || "", accountStatus: c.accountStatus || "Current", notes: "",
        })));
      }
      if (accept.has("__chargeOffs")) {
        await storage.replaceChargeOffs(clientId, (creditReportParsed.chargeOffs || []).map((c: any) => ({
          creditor: c.creditor || "", accountType: c.accountType || "",
          originalAmount: Number(c.originalAmount) || 0, balance: Number(c.balance) || 0,
          openedDate: c.openedDate || "", closedDate: c.closedDate || "", notes: "",
        })));
      }
      if (accept.has("__collections")) {
        await storage.replaceCollections(clientId, (creditReportParsed.collections || []).map((c: any) => ({
          creditor: c.creditor || "", originalCreditor: c.originalCreditor || "",
          balance: Number(c.balance) || 0, reportedDate: c.reportedDate || "", notes: "",
        })));
      }
      if (accept.has("__latePayments")) {
        await storage.replaceLatePayments(clientId, (creditReportParsed.latePayments || []).map((l: any) => ({
          creditor: l.creditor || "", accountType: l.accountType || "",
          status: l.status || "Open", mostRecentLateDate: l.mostRecentLateDate || "",
          lateHistory: l.lateHistory || "",
          withinTwelveMonths: !!l.withinTwelveMonths,
          monthsSinceLate: Number(l.monthsSinceLate) || 0,
        })));
      }
      if (accept.has("__repossessions")) {
        await storage.replaceRepossessions(clientId, (creditReportParsed.repossessions || []).map((r: any) => ({
          creditor: r.creditor || "", accountType: r.accountType || "",
          originalAmount: Number(r.originalAmount) || 0, balance: Number(r.balance) || 0,
          openedDate: r.openedDate || "", repoDate: r.repoDate || "",
          status: r.status || "", notes: "",
        })));
      }
      if (accept.has("__publicRecords")) {
        await storage.replacePublicRecords(clientId, (creditReportParsed.publicRecords || []).map((p: any) => ({
          recordType: (p.recordType || "Other"),
          courtOrAgency: p.courtOrAgency || "", referenceNumber: p.referenceNumber || "",
          amount: Number(p.amount) || 0, status: p.status || "",
          filedDate: p.filedDate || "", notes: "",
        })));
      }
    }

    if (bankStatementParsed) {
      const { patch } = buildBankPatch(bankStatementParsed);
      const filtered: any = {};
      for (const k of Object.keys(patch)) if (accept.has(k)) filtered[k] = patch[k];
      if (Object.keys(filtered).length > 0) await storage.updateClient(clientId, filtered);
    }

    const refreshed = await storage.getClient(clientId);
    res.json({ ok: true, client: refreshed });
  });

  app.get("/api/clients", async (_req: Request, res: Response) => {
    const list = await storage.listClients();
    res.json(list);
  });

  app.get("/api/clients/:id", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const client = await storage.getClient(id);
    if (!client) return res.status(404).json({ message: "Not found" });
    res.json(client);
  });

  app.post("/api/clients", async (req: Request, res: Response) => {
    try {
      // Allow optional credit-analysis sub-arrays in the same payload
      const { chargeOffs: incomingChargeOffs, collections: incomingCollections, latePayments: incomingLatePayments, repossessions: incomingRepossessions, publicRecords: incomingPublicRecords, ...clientFields } = (req.body || {}) as any;
      const data = insertClientSchema.parse(clientFields);
      const created = await storage.createClient(data);
      if (Array.isArray(incomingChargeOffs)) {
        for (const c of incomingChargeOffs) {
          await storage.addChargeOff(created.id, {
            creditor: c.creditor || "",
            accountType: c.accountType || "",
            originalAmount: Number(c.originalAmount) || 0,
            balance: Number(c.balance) || 0,
            openedDate: c.openedDate || "",
            closedDate: c.closedDate || "",
            notes: c.notes || "",
          });
        }
      }
      if (Array.isArray(incomingCollections)) {
        for (const c of incomingCollections) {
          await storage.addCollection(created.id, {
            creditor: c.creditor || "",
            originalCreditor: c.originalCreditor || "",
            balance: Number(c.balance) || 0,
            reportedDate: c.reportedDate || "",
            notes: c.notes || "",
          });
        }
      }
      if (Array.isArray(incomingLatePayments)) {
        for (const l of incomingLatePayments) {
          await storage.addLatePayment(created.id, {
            creditor: l.creditor || "",
            accountType: l.accountType || "",
            status: l.status || "Open",
            mostRecentLateDate: l.mostRecentLateDate || "",
            lateHistory: l.lateHistory || "",
            withinTwelveMonths: !!l.withinTwelveMonths,
            monthsSinceLate: Number(l.monthsSinceLate) || 0,
          } as any);
        }
      }
      if (Array.isArray(incomingRepossessions)) {
        for (const r of incomingRepossessions) {
          await storage.addRepossession(created.id, {
            creditor: r.creditor || "",
            accountType: r.accountType || "",
            originalAmount: Number(r.originalAmount) || 0,
            balance: Number(r.balance) || 0,
            openedDate: r.openedDate || "",
            repoDate: r.repoDate || "",
            status: r.status || "",
            notes: r.notes || "",
          });
        }
      }
      if (Array.isArray(incomingPublicRecords)) {
        for (const p of incomingPublicRecords) {
          await storage.addPublicRecord(created.id, {
            recordType: (p.recordType || "Other") as any,
            courtOrAgency: p.courtOrAgency || "",
            referenceNumber: p.referenceNumber || "",
            amount: Number(p.amount) || 0,
            status: p.status || "",
            filedDate: p.filedDate || "",
            notes: p.notes || "",
          });
        }
      }
      res.status(201).json(created);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: "Invalid", errors: e.errors });
      throw e;
    }
  });

  app.get("/api/clients/:id/credit-analysis", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const client = await storage.getClient(id);
    if (!client) return res.status(404).json({ message: "Not found" });
    const [chargeOffs, collections, latePayments, repossessions, publicRecords] = await Promise.all([
      storage.listChargeOffs(id),
      storage.listCollections(id),
      storage.listLatePayments(id),
      storage.listRepossessions(id),
      storage.listPublicRecords(id),
    ]);
    const { creditCards, files, ...clientOnly } = client;
    res.json({ client: clientOnly, chargeOffs, collections, latePayments, repossessions, publicRecords });
  });

  app.patch("/api/clients/:id", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    try {
      const data = updateClientSchema.parse(req.body);
      const updated = await storage.updateClient(id, data);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: "Invalid", errors: e.errors });
      throw e;
    }
  });

  app.delete("/api/clients/:id", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const ok = await storage.deleteClient(id);
    if (!ok) return res.status(404).json({ message: "Not found" });
    res.json({ ok: true });
  });

  app.post("/api/clients/:id/cards", async (req: Request, res: Response) => {
    const clientId = Number(req.params.id);
    if (!Number.isFinite(clientId)) return res.status(400).json({ message: "Invalid id" });
    try {
      const data = insertCreditCardSchema.omit({ clientId: true }).parse(req.body);
      const created = await storage.addCard(clientId, data);
      res.status(201).json(created);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: "Invalid", errors: e.errors });
      throw e;
    }
  });

  app.patch("/api/cards/:id", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    try {
      const data = updateCreditCardSchema.parse(req.body);
      const updated = await storage.updateCard(id, data);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: "Invalid", errors: e.errors });
      throw e;
    }
  });

  app.delete("/api/cards/:id", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const ok = await storage.deleteCard(id);
    if (!ok) return res.status(404).json({ message: "Not found" });
    res.json({ ok: true });
  });

  app.post("/api/clients/:id/files", async (req: Request, res: Response) => {
    const clientId = Number(req.params.id);
    if (!Number.isFinite(clientId)) return res.status(400).json({ message: "Invalid id" });
    try {
      const data = insertUploadedFileSchema.omit({ clientId: true }).parse(req.body);
      const created = await storage.addFile(clientId, data);
      // Don't return base64 in response (large)
      const { base64Content, ...rest } = created as any;
      res.status(201).json(rest);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: "Invalid", errors: e.errors });
      throw e;
    }
  });

  app.get("/api/files/:id", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const file = await storage.getFile(id);
    if (!file) return res.status(404).json({ message: "Not found" });
    res.json(file);
  });

  app.delete("/api/files/:id", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const ok = await storage.deleteFile(id);
    if (!ok) return res.status(404).json({ message: "Not found" });
    res.json({ ok: true });
  });

  return httpServer;
}
