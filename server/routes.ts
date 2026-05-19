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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Increase body size for base64 file uploads
  // (already set in index.ts via express.json default; bump via middleware)

  await seedIfEmpty().catch((e) => console.error("Seed error:", e));

  // Extract client data from a credit-report PDF using Claude
  app.post("/api/extract-credit-report", async (req: Request, res: Response) => {
    try {
      const { fileBase64, fileName } = req.body as { fileBase64?: string; fileName?: string };
      if (!fileBase64) return res.status(400).json({ message: "Missing fileBase64" });
      // Strip data: prefix if present
      const cleaned = fileBase64.includes(",") ? fileBase64.split(",")[1] : fileBase64;

      const systemPrompt = `You are a JSON-only API. Output ONLY valid JSON matching this exact schema (no markdown, no commentary, no explanation):
{
  "name": string,
  "address": string,
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
Extract from the attached credit report PDF. Dates use "YYYY-MM" format. lateHistory is a short summary like "1x60d 1x90d" or "24x90d" describing how many times late and severity. withinTwelveMonths is true if the most recent late payment occurred within the last 12 months from today. monthsSinceLate is the integer number of months between the most recent late date and today (use 0 if unknown). repossessions includes vehicle or asset repossessions — list each one. publicRecords includes bankruptcies, judgments, foreclosures, tax liens; recordType MUST be one of the listed values. If a field is unknown, use null (or empty string for required strings, 0 for numbers, [] for arrays). For accountStatus, use "Current" by default. Return ONLY the JSON object.`;

      const client = new Anthropic();
      const message = await client.messages.create({
        model: "claude_sonnet_4_5" as any,
        max_tokens: 4000,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: cleaned },
              } as any,
              { type: "text", text: "Extract client data from this credit report PDF. Return ONLY the JSON object per the schema." },
            ],
          },
        ],
      });

      const text = (message.content || [])
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n")
        .trim();

      // Strip markdown fences if any
      const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      let parsed: any;
      try {
        parsed = JSON.parse(stripped);
      } catch (err) {
        // Try to extract first JSON object
        const match = stripped.match(/\{[\s\S]*\}/);
        if (!match) {
          return res.status(422).json({ message: "Could not parse extracted data", raw: text });
        }
        parsed = JSON.parse(match[0]);
      }

      res.json({ extracted: parsed, fileName: fileName || "credit-report.pdf" });
    } catch (e: any) {
      console.error("Extract error:", e);
      res.status(500).json({ message: e?.message || "Extraction failed" });
    }
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
