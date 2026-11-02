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
import {
  extractCreditReport,
  extractBankStatement,
  buildCreditReportPatch,
  buildBankPatch,
  normalizeCreditReport,
  toChildTables,
  deriveNameFromFilename,
} from "./extraction";
import { formatBureauScores } from "@shared/creditLogic";

// ====== Field-label registry for the review modal ======
export const FIELD_LABELS: Record<string, { label: string; section: string; format?: "number" | "text" | "bool" | "money" | "percent" }> = {
  recentCreditReport: { label: "Credit Score", section: "Credit Report", format: "text" },
  equifaxScore: { label: "Equifax Score", section: "Credit Report", format: "number" },
  experianScore: { label: "Experian Score", section: "Credit Report", format: "number" },
  transunionScore: { label: "TransUnion Score", section: "Credit Report", format: "number" },
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

type Diff = {
  key: string;
  label: string;
  section: string;
  format: string;
  currentValue: unknown;
  proposedValue: unknown;
  changed: boolean;
};

function diffPatch(current: Record<string, any>, patch: Record<string, any>): Diff[] {
  const out: Diff[] = [];
  for (const key of Object.keys(patch)) {
    const meta = FIELD_LABELS[key];
    if (!meta) continue;
    const cur = current[key];
    const next = patch[key];
    const changed = String(cur ?? "") !== String(next ?? "");
    out.push({ key, label: meta.label, section: meta.section, format: meta.format || "text", currentValue: cur, proposedValue: next, changed });
  }
  return out;
}

// ---- Request body schemas ----
const base64Pdf = z.string().min(100, "File content is missing or empty");

const extractBody = z.object({
  fileBase64: base64Pdf,
  fileName: z.string().max(500).optional(),
});

const looseRecord = z.record(z.string(), z.unknown());
const looseArray = z.array(looseRecord).max(1000);

const applyBody = z.object({
  acceptedKeys: z.array(z.string()).max(200),
  creditReportParsed: looseRecord.nullable().optional(),
  bankStatementParsed: looseRecord.nullable().optional(),
});

const childArrays = {
  creditCards: looseArray.optional(),
  chargeOffs: looseArray.optional(),
  collections: looseArray.optional(),
  latePayments: looseArray.optional(),
  repossessions: looseArray.optional(),
  publicRecords: looseArray.optional(),
};

function parseId(raw: unknown): number | null {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function zodError(res: Response, e: z.ZodError) {
  return res.status(400).json({ message: "Invalid request", errors: e.errors });
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  await seedIfEmpty().catch((e) => console.error("Seed error:", e));

  // Lightweight health check for Railway (no client data in the response).
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Extract client data from a credit-report PDF (New Client flow). Not saved.
  app.post("/api/extract-credit-report", async (req: Request, res: Response) => {
    const body = extractBody.safeParse(req.body);
    if (!body.success) return zodError(res, body.error);
    const { fileBase64, fileName } = body.data;
    try {
      const { parsed, method, warnings } = await extractCreditReport(fileBase64);
      console.log(`[extract-credit-report] method=${method} warnings=${warnings.length}`);
      // Name came back empty or as a placeholder: fall back to the consultant's file naming.
      if (!parsed.name) parsed.name = deriveNameFromFilename(fileName);
      res.json({ extracted: parsed, method, warnings, fileName: fileName || "credit-report.pdf" });
    } catch (e: any) {
      console.error("Extract error:", e?.message || e);
      res.status(500).json({ message: e?.message || "Extraction failed" });
    }
  });

  // PREVIEW: re-extract from the latest stored files; return a diff without writing.
  app.post("/api/clients/:id/preview-from-files", async (req: Request, res: Response) => {
    const clientId = parseId(req.params.id);
    if (!clientId) return res.status(400).json({ message: "Invalid id" });
    const client = await storage.getClient(clientId);
    if (!client) return res.status(404).json({ message: "Client not found" });

    const latestOf = (type: string) =>
      client.files
        .filter((f) => f.fileType === type)
        .sort((a, b) => (b.uploadedAt || "").localeCompare(a.uploadedAt || ""))[0];
    const latestCreditReport = latestOf("credit_report");
    const latestBankStatement = latestOf("bank_statement");

    if (!latestCreditReport && !latestBankStatement) {
      return res.status(400).json({ message: "No credit report or bank statement uploaded yet. Upload a PDF first, then click Update again." });
    }

    const out: any = { errors: [], warnings: [], creditReport: null, bankStatement: null };

    if (latestCreditReport) {
      try {
        const file = await storage.getFile(latestCreditReport.id);
        if (!file?.base64Content) throw new Error("Credit report file has no content stored");
        const { parsed, method, warnings } = await extractCreditReport(file.base64Content);
        console.log(`[preview-credit-report] method=${method} warnings=${warnings.length}`);
        out.warnings.push(...warnings.map((w) => `Credit report: ${w}`));
        const patch = buildCreditReportPatch(parsed);
        const fieldDiffs = diffPatch(client, patch);

        const [cos, cols, lates, repos, prs] = await Promise.all([
          storage.listChargeOffs(clientId),
          storage.listCollections(clientId),
          storage.listLatePayments(clientId),
          storage.listRepossessions(clientId),
          storage.listPublicRecords(clientId),
        ]);
        const tableSpecs: Array<[string, any[], number]> = [
          ["__cards", parsed.creditCards, client.creditCards.length],
          ["__chargeOffs", parsed.chargeOffs, cos.length],
          ["__collections", parsed.collections, cols.length],
          ["__latePayments", parsed.latePayments, lates.length],
          ["__repossessions", parsed.repossessions, repos.length],
          ["__publicRecords", parsed.publicRecords, prs.length],
        ];
        const plural = (n: number) => `${n} item${n === 1 ? "" : "s"}`;
        const tableDiffs: Diff[] = tableSpecs.map(([key, list, currentCount]) => ({
          key,
          label: FIELD_LABELS[key].label,
          section: "Credit Report",
          format: "text",
          currentValue: plural(currentCount),
          proposedValue: plural(list.length),
          // Same count can still mean different rows, so any non-empty table is offered.
          changed: currentCount !== list.length || list.length > 0,
        }));
        out.creditReport = {
          fileName: latestCreditReport.fileName,
          fileId: latestCreditReport.id,
          diffs: [...fieldDiffs, ...tableDiffs],
          allAccounts: parsed.allAccounts || [],
          parsed, // full payload so apply doesn't re-run the AI
        };
      } catch (e: any) {
        console.error("Credit report preview error:", e?.message || e);
        out.errors.push(`Credit report (${latestCreditReport.fileName}): ${e?.message || "failed"}`);
      }
    }

    if (latestBankStatement) {
      try {
        const file = await storage.getFile(latestBankStatement.id);
        if (!file?.base64Content) throw new Error("Bank statement file has no content stored");
        const { parsed, method, warnings } = await extractBankStatement(file.base64Content);
        console.log(`[preview-bank-statement] method=${method} warnings=${warnings.length}`);
        out.warnings.push(...warnings.map((w) => `Bank statement: ${w}`));
        const { patch, isBiz, accounts } = buildBankPatch(parsed);
        out.bankStatement = {
          fileName: latestBankStatement.fileName,
          fileId: latestBankStatement.id,
          accountHolderName: parsed.accountHolderName || null,
          bankName: parsed.bankName || null,
          isBusinessAccount: isBiz,
          businessClassificationReason: parsed.businessClassificationReason || null,
          accountsFound: accounts.length,
          accounts,
          diffs: diffPatch(client, patch),
          parsed,
        };
      } catch (e: any) {
        console.error("Bank statement preview error:", e?.message || e);
        out.errors.push(`Bank statement (${latestBankStatement.fileName}): ${e?.message || "failed"}`);
      }
    }

    res.json(out);
  });

  // APPLY: write only the fields and tables the user accepted, in one transaction.
  app.post("/api/clients/:id/apply-from-files", async (req: Request, res: Response) => {
    const clientId = parseId(req.params.id);
    if (!clientId) return res.status(400).json({ message: "Invalid id" });
    const body = applyBody.safeParse(req.body);
    if (!body.success) return zodError(res, body.error);
    const client = await storage.getClient(clientId);
    if (!client) return res.status(404).json({ message: "Client not found" });

    const accept = new Set(body.data.acceptedKeys);
    const patch: Record<string, any> = {};
    const tables: Parameters<typeof storage.applyExtraction>[2] = {};

    if (body.data.creditReportParsed) {
      const parsed = normalizeCreditReport(body.data.creditReportParsed);
      const full = buildCreditReportPatch(parsed);
      for (const k of Object.keys(full)) if (accept.has(k)) patch[k] = full[k];
      const rows = toChildTables(parsed);
      // A replaced table always brings its summary count(s) along, so the
      // KPI cards can never disagree with the rows underneath them.
      const tableCounts: Array<[string, keyof typeof rows, string[]]> = [
        ["__cards", "creditCards", ["creditUtilization"]],
        ["__chargeOffs", "chargeOffs", ["chargeOffsCount"]],
        ["__collections", "collections", ["collectionsCount"]],
        ["__latePayments", "latePayments", ["latePaymentsCount", "latePaymentsWithin12moCount", "latePayments12to24moCount", "latePaymentsOlder24moCount"]],
        ["__repossessions", "repossessions", ["repossessionsCount"]],
        ["__publicRecords", "publicRecords", ["publicRecordsCount"]],
      ];
      for (const [key, table, countKeys] of tableCounts) {
        if (!accept.has(key)) continue;
        (tables as any)[table] = rows[table];
        for (const k of countKeys) if (k in full) patch[k] = full[k];
      }
      // Rebuild the score summary from the scores the client will actually have.
      if (["equifaxScore", "experianScore", "transunionScore", "recentCreditReport"].some((k) => k in patch)) {
        const pick = (k: "equifaxScore" | "experianScore" | "transunionScore") => (k in patch ? patch[k] : client[k]);
        const tri = formatBureauScores(pick("equifaxScore"), pick("experianScore"), pick("transunionScore"));
        if (tri) patch.recentCreditReport = tri;
      }
    }

    if (body.data.bankStatementParsed) {
      const { patch: bankPatch } = buildBankPatch(body.data.bankStatementParsed);
      for (const k of Object.keys(bankPatch)) if (accept.has(k)) patch[k] = bankPatch[k];
    }

    const validPatch = updateClientSchema.safeParse(patch);
    if (!validPatch.success) return zodError(res, validPatch.error);
    storage.applyExtraction(clientId, validPatch.data, tables);

    res.json({ ok: true, client: await storage.getClient(clientId) });
  });

  // Dashboard list: each client with its cards (needed for the readiness score).
  app.get("/api/clients", async (_req: Request, res: Response) => {
    res.json(await storage.listClientsWithCards());
  });

  app.get("/api/clients/:id", async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid id" });
    const client = await storage.getClient(id);
    if (!client) return res.status(404).json({ message: "Not found" });
    res.json(client);
  });

  // Create a client, optionally with extracted cards and derogatory tables (atomic).
  app.post("/api/clients", async (req: Request, res: Response) => {
    const children = z.object(childArrays).safeParse(req.body || {});
    if (!children.success) return zodError(res, children.error);
    const { creditCards, chargeOffs, collections, latePayments, repossessions, publicRecords, ...clientFields } =
      (req.body || {}) as Record<string, any>;
    const data = insertClientSchema.safeParse(clientFields);
    if (!data.success) return zodError(res, data.error);

    const rows = toChildTables({ creditCards, chargeOffs, collections, latePayments, repossessions, publicRecords });
    const created = storage.createClientWithChildren(data.data, {
      creditCards: creditCards ? rows.creditCards : undefined,
      chargeOffs: chargeOffs ? rows.chargeOffs : undefined,
      collections: collections ? rows.collections : undefined,
      latePayments: latePayments ? rows.latePayments : undefined,
      repossessions: repossessions ? rows.repossessions : undefined,
      publicRecords: publicRecords ? rows.publicRecords : undefined,
    });
    res.status(201).json(created);
  });

  app.get("/api/clients/:id/credit-analysis", async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid id" });
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
    if (!(await storage.getClient(clientId))) return res.status(404).json({ message: "Client not found" });
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
    if (!(await storage.getClient(clientId))) return res.status(404).json({ message: "Client not found" });
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

