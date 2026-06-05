import { clients, creditCards, uploadedFiles, chargeOffs, collections, latePayments, repossessions, publicRecords } from "@shared/schema";
import type {
  Client,
  InsertClient,
  UpdateClient,
  CreditCard,
  InsertCreditCard,
  UpdateCreditCard,
  UploadedFile,
  InsertUploadedFile,
  ClientWithDetails,
  ChargeOff,
  InsertChargeOff,
  Collection,
  InsertCollection,
  LatePayment,
  InsertLatePayment,
  Repossession,
  InsertRepossession,
  PublicRecord,
  InsertPublicRecord,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";

// Database path is configurable so Railway (or any host) can mount a persistent
// volume and store the DB outside the deployment bundle. Locally it stays at
// ./data.db. On Railway, set DATABASE_PATH=/data/data.db and mount a volume at /data.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
const DB_PATH = process.env.DATABASE_PATH || "data.db";
try {
  const dir = dirname(DB_PATH);
  if (dir && dir !== ".") mkdirSync(dir, { recursive: true });
} catch {}
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");

// Create tables if they don't exist (since we don't run drizzle migrations in this template)
sqlite.exec(`
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  onboarding_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'New',
  last_updated TEXT NOT NULL,
  num_bank_accounts INTEGER NOT NULL DEFAULT 0,
  bank_accounts_list TEXT NOT NULL DEFAULT '',
  bank_accounts_age TEXT NOT NULL DEFAULT '',
  has_savings INTEGER NOT NULL DEFAULT 0,
  has_retirement_401k INTEGER NOT NULL DEFAULT 0,
  recent_credit_report TEXT NOT NULL DEFAULT '',
  credit_utilization REAL NOT NULL DEFAULT 0,
  active_llc INTEGER NOT NULL DEFAULT 0,
  llc_name TEXT NOT NULL DEFAULT '',
  has_business_accounts INTEGER NOT NULL DEFAULT 0,
  business_accounts_list TEXT NOT NULL DEFAULT '',
  business_accounts_age TEXT NOT NULL DEFAULT '',
  generating_revenue INTEGER NOT NULL DEFAULT 0,
  monthly_revenue REAL NOT NULL DEFAULT 0,
  annual_revenue REAL NOT NULL DEFAULT 0,
  has_business_products INTEGER NOT NULL DEFAULT 0,
  business_credit_cards TEXT NOT NULL DEFAULT '',
  business_loans TEXT NOT NULL DEFAULT '',
  business_lines_of_credit TEXT NOT NULL DEFAULT '',
  getting_offers_in_mail INTEGER NOT NULL DEFAULT 0,
  personal_notes TEXT NOT NULL DEFAULT '',
  business_notes TEXT NOT NULL DEFAULT '',
  internal_notes TEXT NOT NULL DEFAULT '',
  funding_readiness_score_override INTEGER,
  personal_banking_strength_override INTEGER,
  business_banking_strength_override INTEGER,
  credit_utilization_status_override TEXT,
  business_revenue_status_override TEXT,
  missing_documents TEXT NOT NULL DEFAULT '[]',
  recommended_next_steps TEXT NOT NULL DEFAULT '',
  credit_analysis_date TEXT NOT NULL DEFAULT '',
  charge_offs_count INTEGER NOT NULL DEFAULT 0,
  collections_count INTEGER NOT NULL DEFAULT 0,
  late_payments_count INTEGER NOT NULL DEFAULT 0,
  late_payments_within_12mo_count INTEGER NOT NULL DEFAULT 0,
  late_payments_12_to_24mo_count INTEGER NOT NULL DEFAULT 0,
  late_payments_older_24mo_count INTEGER NOT NULL DEFAULT 0,
  repossessions_count INTEGER NOT NULL DEFAULT 0,
  public_records_count INTEGER NOT NULL DEFAULT 0,
  total_accounts_count INTEGER NOT NULL DEFAULT 0,
  avg_account_age_years INTEGER NOT NULL DEFAULT 0,
  avg_account_age_months INTEGER NOT NULL DEFAULT 0,
  oldest_account_creditor TEXT NOT NULL DEFAULT '',
  oldest_account_year INTEGER NOT NULL DEFAULT 0,
  newest_account_creditor TEXT NOT NULL DEFAULT '',
  newest_account_year INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS charge_offs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  creditor TEXT NOT NULL DEFAULT '',
  account_type TEXT NOT NULL DEFAULT '',
  original_amount REAL NOT NULL DEFAULT 0,
  balance REAL NOT NULL DEFAULT 0,
  opened_date TEXT NOT NULL DEFAULT '',
  closed_date TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  creditor TEXT NOT NULL DEFAULT '',
  original_creditor TEXT NOT NULL DEFAULT '',
  balance REAL NOT NULL DEFAULT 0,
  reported_date TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS late_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  creditor TEXT NOT NULL DEFAULT '',
  account_type TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Open',
  most_recent_late_date TEXT NOT NULL DEFAULT '',
  late_history TEXT NOT NULL DEFAULT '',
  within_twelve_months INTEGER NOT NULL DEFAULT 0,
  months_since_late INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS repossessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  creditor TEXT NOT NULL DEFAULT '',
  account_type TEXT NOT NULL DEFAULT '',
  original_amount REAL NOT NULL DEFAULT 0,
  balance REAL NOT NULL DEFAULT 0,
  opened_date TEXT NOT NULL DEFAULT '',
  repo_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  record_type TEXT NOT NULL DEFAULT 'Other',
  court_or_agency TEXT NOT NULL DEFAULT '',
  reference_number TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '',
  filed_date TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS credit_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  card_name TEXT NOT NULL DEFAULT '',
  issuer TEXT NOT NULL DEFAULT '',
  credit_limit REAL NOT NULL DEFAULT 0,
  current_balance REAL NOT NULL DEFAULT 0,
  payment_due_date TEXT NOT NULL DEFAULT '',
  minimum_payment REAL NOT NULL DEFAULT 0,
  account_status TEXT NOT NULL DEFAULT 'Current',
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS uploaded_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'other',
  uploaded_at TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  base64_content TEXT NOT NULL DEFAULT ''
);
`);

// ---- Lightweight migrations for existing DBs (idempotent) ----
function columnExists(table: string, column: string): boolean {
  try {
    const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return rows.some((r) => r.name === column);
  } catch {
    return false;
  }
}
if (!columnExists("clients", "address")) {
  sqlite.exec(`ALTER TABLE clients ADD COLUMN address TEXT NOT NULL DEFAULT ''`);
}
// Tri-bureau credit score columns
if (!columnExists("clients", "equifax_score")) {
  sqlite.exec(`ALTER TABLE clients ADD COLUMN equifax_score INTEGER`);
}
if (!columnExists("clients", "experian_score")) {
  sqlite.exec(`ALTER TABLE clients ADD COLUMN experian_score INTEGER`);
}
if (!columnExists("clients", "transunion_score")) {
  sqlite.exec(`ALTER TABLE clients ADD COLUMN transunion_score INTEGER`);
  // One-time backfill: parse existing recent_credit_report free-text into the
  // 3 columns. Handles formats like:
  //   "Equifax 702, Experian 691, TransUnion 708"
  //   "747 (TransUnion)"
  //   "720" (no bureau → we leave columns null and keep free text)
  try {
    const rows = sqlite.prepare(
      `SELECT id, recent_credit_report FROM clients WHERE recent_credit_report IS NOT NULL AND recent_credit_report != ''`,
    ).all() as Array<{ id: number; recent_credit_report: string }>;
    const update = sqlite.prepare(
      `UPDATE clients SET equifax_score = ?, experian_score = ?, transunion_score = ? WHERE id = ?`,
    );
    for (const r of rows) {
      const s = r.recent_credit_report;
      let eq: number | null = null, ex: number | null = null, tu: number | null = null;
      // Pattern 1: "<Bureau> <score>"
      const m1 = s.match(/equifax\s*[:\-]?\s*(\d{2,3})/i); if (m1) eq = parseInt(m1[1]);
      const m2 = s.match(/experian\s*[:\-]?\s*(\d{2,3})/i); if (m2) ex = parseInt(m2[1]);
      const m3 = s.match(/trans\s*union\s*[:\-]?\s*(\d{2,3})/i); if (m3) tu = parseInt(m3[1]);
      // Pattern 2: "<score> (<Bureau>)"
      const m4 = s.match(/(\d{2,3})\s*\(\s*(equifax|experian|trans\s*union)\s*\)/i);
      if (m4) {
        const score = parseInt(m4[1]);
        const bureau = m4[2].toLowerCase().replace(/\s+/g, "");
        if (bureau === "equifax" && eq == null) eq = score;
        if (bureau === "experian" && ex == null) ex = score;
        if (bureau === "transunion" && tu == null) tu = score;
      }
      if (eq != null || ex != null || tu != null) {
        update.run(eq, ex, tu, r.id);
      }
    }
  } catch (e) {
    console.warn("Tri-bureau backfill skipped:", e);
  }
}

export const db = drizzle(sqlite);

export interface IStorage {
  listClients(): Promise<Client[]>;
  getClient(id: number): Promise<ClientWithDetails | undefined>;
  createClient(data: InsertClient): Promise<Client>;
  updateClient(id: number, data: UpdateClient): Promise<Client | undefined>;
  deleteClient(id: number): Promise<boolean>;

  addCard(clientId: number, data: Omit<InsertCreditCard, "clientId">): Promise<CreditCard>;
  updateCard(id: number, data: UpdateCreditCard): Promise<CreditCard | undefined>;
  deleteCard(id: number): Promise<boolean>;

  addFile(clientId: number, data: Omit<InsertUploadedFile, "clientId">): Promise<UploadedFile>;
  getFile(id: number): Promise<UploadedFile | undefined>;
  deleteFile(id: number): Promise<boolean>;

  addChargeOff(clientId: number, data: Omit<InsertChargeOff, "clientId">): Promise<ChargeOff>;
  addCollection(clientId: number, data: Omit<InsertCollection, "clientId">): Promise<Collection>;
  addLatePayment(clientId: number, data: Omit<InsertLatePayment, "clientId">): Promise<LatePayment>;
  addRepossession(clientId: number, data: Omit<InsertRepossession, "clientId">): Promise<Repossession>;
  addPublicRecord(clientId: number, data: Omit<InsertPublicRecord, "clientId">): Promise<PublicRecord>;
  listChargeOffs(clientId: number): Promise<ChargeOff[]>;
  listCollections(clientId: number): Promise<Collection[]>;
  listLatePayments(clientId: number): Promise<LatePayment[]>;
  listRepossessions(clientId: number): Promise<Repossession[]>;
  listPublicRecords(clientId: number): Promise<PublicRecord[]>;
}

function nowIso() {
  return new Date().toISOString();
}

export class DatabaseStorage implements IStorage {
  async listClients(): Promise<Client[]> {
    return db.select().from(clients).all();
  }

  async getClient(id: number): Promise<ClientWithDetails | undefined> {
    const client = db.select().from(clients).where(eq(clients.id, id)).get();
    if (!client) return undefined;
    const cards = db.select().from(creditCards).where(eq(creditCards.clientId, id)).all();
    const files = db.select().from(uploadedFiles).where(eq(uploadedFiles.clientId, id)).all();
    return { ...client, creditCards: cards, files };
  }

  async createClient(data: InsertClient): Promise<Client> {
    const lastUpdated = nowIso();
    return db
      .insert(clients)
      .values({ ...data, lastUpdated } as any)
      .returning()
      .get();
  }

  async updateClient(id: number, data: UpdateClient): Promise<Client | undefined> {
    const lastUpdated = nowIso();
    return db
      .update(clients)
      .set({ ...data, lastUpdated } as any)
      .where(eq(clients.id, id))
      .returning()
      .get();
  }

  async deleteClient(id: number): Promise<boolean> {
    const r = db.delete(clients).where(eq(clients.id, id)).run();
    return r.changes > 0;
  }

  async addCard(clientId: number, data: Omit<InsertCreditCard, "clientId">): Promise<CreditCard> {
    return db
      .insert(creditCards)
      .values({ ...data, clientId } as any)
      .returning()
      .get();
  }

  async updateCard(id: number, data: UpdateCreditCard): Promise<CreditCard | undefined> {
    return db.update(creditCards).set(data as any).where(eq(creditCards.id, id)).returning().get();
  }

  async deleteCard(id: number): Promise<boolean> {
    const r = db.delete(creditCards).where(eq(creditCards.id, id)).run();
    return r.changes > 0;
  }

  async addFile(clientId: number, data: Omit<InsertUploadedFile, "clientId">): Promise<UploadedFile> {
    return db
      .insert(uploadedFiles)
      .values({ ...data, clientId, uploadedAt: nowIso() } as any)
      .returning()
      .get();
  }

  async getFile(id: number): Promise<UploadedFile | undefined> {
    return db.select().from(uploadedFiles).where(eq(uploadedFiles.id, id)).get();
  }

  async deleteFile(id: number): Promise<boolean> {
    const r = db.delete(uploadedFiles).where(eq(uploadedFiles.id, id)).run();
    return r.changes > 0;
  }

  async addChargeOff(clientId: number, data: Omit<InsertChargeOff, "clientId">): Promise<ChargeOff> {
    return db.insert(chargeOffs).values({ ...data, clientId } as any).returning().get();
  }
  async addCollection(clientId: number, data: Omit<InsertCollection, "clientId">): Promise<Collection> {
    return db.insert(collections).values({ ...data, clientId } as any).returning().get();
  }
  async addLatePayment(clientId: number, data: Omit<InsertLatePayment, "clientId">): Promise<LatePayment> {
    return db.insert(latePayments).values({ ...data, clientId } as any).returning().get();
  }
  async listChargeOffs(clientId: number): Promise<ChargeOff[]> {
    return db.select().from(chargeOffs).where(eq(chargeOffs.clientId, clientId)).all();
  }
  async listCollections(clientId: number): Promise<Collection[]> {
    return db.select().from(collections).where(eq(collections.clientId, clientId)).all();
  }
  async listLatePayments(clientId: number): Promise<LatePayment[]> {
    return db.select().from(latePayments).where(eq(latePayments.clientId, clientId)).all();
  }
  async addRepossession(clientId: number, data: Omit<InsertRepossession, "clientId">): Promise<Repossession> {
    return db.insert(repossessions).values({ ...data, clientId } as any).returning().get();
  }
  async addPublicRecord(clientId: number, data: Omit<InsertPublicRecord, "clientId">): Promise<PublicRecord> {
    return db.insert(publicRecords).values({ ...data, clientId } as any).returning().get();
  }
  async listRepossessions(clientId: number): Promise<Repossession[]> {
    return db.select().from(repossessions).where(eq(repossessions.clientId, clientId)).all();
  }
  async listPublicRecords(clientId: number): Promise<PublicRecord[]> {
    return db.select().from(publicRecords).where(eq(publicRecords.clientId, clientId)).all();
  }

  // Replace-all helpers — used when re-extracting from a file (refresh-from-files endpoint)
  async replaceCards(clientId: number, items: Array<Omit<InsertCreditCard, "clientId">>): Promise<void> {
    db.delete(creditCards).where(eq(creditCards.clientId, clientId)).run();
    for (const it of items) {
      db.insert(creditCards).values({ ...it, clientId } as any).run();
    }
  }
  async replaceChargeOffs(clientId: number, items: Array<Omit<InsertChargeOff, "clientId">>): Promise<void> {
    db.delete(chargeOffs).where(eq(chargeOffs.clientId, clientId)).run();
    for (const it of items) db.insert(chargeOffs).values({ ...it, clientId } as any).run();
  }
  async replaceCollections(clientId: number, items: Array<Omit<InsertCollection, "clientId">>): Promise<void> {
    db.delete(collections).where(eq(collections.clientId, clientId)).run();
    for (const it of items) db.insert(collections).values({ ...it, clientId } as any).run();
  }
  async replaceLatePayments(clientId: number, items: Array<Omit<InsertLatePayment, "clientId">>): Promise<void> {
    db.delete(latePayments).where(eq(latePayments.clientId, clientId)).run();
    for (const it of items) db.insert(latePayments).values({ ...it, clientId } as any).run();
  }
  async replaceRepossessions(clientId: number, items: Array<Omit<InsertRepossession, "clientId">>): Promise<void> {
    db.delete(repossessions).where(eq(repossessions.clientId, clientId)).run();
    for (const it of items) db.insert(repossessions).values({ ...it, clientId } as any).run();
  }
  async replacePublicRecords(clientId: number, items: Array<Omit<InsertPublicRecord, "clientId">>): Promise<void> {
    db.delete(publicRecords).where(eq(publicRecords.clientId, clientId)).run();
    for (const it of items) db.insert(publicRecords).values({ ...it, clientId } as any).run();
  }
}

export const storage = new DatabaseStorage();

// Seed sample data
export async function seedIfEmpty() {
  const existing = await storage.listClients();
  if (existing.length > 0) return;

  const maria = await storage.createClient({
    name: "Maria Rodriguez",
    phone: "(305) 555-0142",
    email: "maria.rodriguez@example.com",
    onboardingDate: "2025-08-15",
    status: "Funding Ready",
    numBankAccounts: 4,
    bankAccountsList: "Chase Checking, Chase Savings, Bank of America Checking, Capital One 360 Savings",
    bankAccountsAge: "5+ years (Chase), 2 years (BoA), 3 years (Capital One)",
    hasSavings: true,
    hasRetirement401k: true,
    recentCreditReport: "Experian 752, Equifax 748, TransUnion 755 (pulled Oct 2025)",
    creditUtilization: 12,
    activeLLC: true,
    llcName: "Rodriguez Marketing Solutions LLC",
    hasBusinessAccounts: true,
    businessAccountsList: "Chase Business Complete, Mercury Business",
    businessAccountsAge: "18 months",
    generatingRevenue: true,
    monthlyRevenue: 15000,
    annualRevenue: 180000,
    hasBusinessProducts: true,
    businessCreditCards: "Chase Ink Preferred ($25k limit), Amex Business Gold",
    businessLoans: "",
    businessLinesOfCredit: "Bluevine $20k LOC",
    gettingOffersInMail: true,
    personalNotes: "Stable W2 income plus business income. Excellent payment history.",
    businessNotes: "Marketing agency, 3 clients on retainer. Looking to expand with funding.",
    internalNotes: "High priority. Ready for tier 2 business credit applications.",
    missingDocuments: JSON.stringify(["Last 2 bank statements"]),
    recommendedNextSteps: "",
    creditAnalysisDate: "2025-10-20",
    chargeOffsCount: 0,
    collectionsCount: 0,
    latePaymentsCount: 0,
    latePaymentsWithin12moCount: 0,
    latePayments12to24moCount: 0,
    latePaymentsOlder24moCount: 0,
    repossessionsCount: 0,
    publicRecordsCount: 0,
    totalAccountsCount: 5,
    avgAccountAgeYears: 6,
    avgAccountAgeMonths: 0,
    oldestAccountCreditor: "CHASE",
    oldestAccountYear: 2020,
    newestAccountCreditor: "AMEX",
    newestAccountYear: 2024,
  } as any);

  await storage.addCard(maria.id, {
    cardName: "Chase Sapphire Preferred",
    issuer: "Chase",
    creditLimit: 15000,
    currentBalance: 1200,
    paymentDueDate: "2025-11-15",
    minimumPayment: 35,
    accountStatus: "Current",
    notes: "Primary spending card",
  });
  await storage.addCard(maria.id, {
    cardName: "Amex Gold",
    issuer: "American Express",
    creditLimit: 10000,
    currentBalance: 850,
    paymentDueDate: "2025-11-20",
    minimumPayment: 35,
    accountStatus: "Current",
    notes: "",
  });
  await storage.addCard(maria.id, {
    cardName: "Capital One Venture",
    issuer: "Capital One",
    creditLimit: 8000,
    currentBalance: 600,
    paymentDueDate: "2025-11-12",
    minimumPayment: 25,
    accountStatus: "Current",
    notes: "Travel rewards",
  });

  const james = await storage.createClient({
    name: "James Thompson",
    phone: "(404) 555-0188",
    email: "james.t@example.com",
    onboardingDate: "2025-09-22",
    status: "In Progress",
    numBankAccounts: 1,
    bankAccountsList: "Wells Fargo Checking",
    bankAccountsAge: "8 months",
    hasSavings: false,
    hasRetirement401k: false,
    recentCreditReport: "Equifax 612 (pulled Sep 2025)",
    creditUtilization: 0,
    activeLLC: false,
    llcName: "",
    hasBusinessAccounts: false,
    businessAccountsList: "",
    businessAccountsAge: "",
    generatingRevenue: false,
    monthlyRevenue: 0,
    annualRevenue: 0,
    hasBusinessProducts: false,
    businessCreditCards: "",
    businessLoans: "",
    businessLinesOfCredit: "",
    gettingOffersInMail: false,
    personalNotes: "Single bank account, no savings. Has W2 from delivery job.",
    businessNotes: "Wants to start a logistics business. No structure yet.",
    internalNotes: "Needs foundation work: LLC formation, business banking, pay down cards.",
    missingDocuments: JSON.stringify([
      "Government-issued ID",
      "Recent pay stubs",
      "2 months of bank statements",
      "Utility bill (proof of address)",
    ]),
    recommendedNextSteps: "",
    creditAnalysisDate: "2026-05-19",
    chargeOffsCount: 2,
    collectionsCount: 1,
    latePaymentsCount: 3,
    latePaymentsWithin12moCount: 1,
    latePayments12to24moCount: 1,
    latePaymentsOlder24moCount: 1,
    repossessionsCount: 1,
    publicRecordsCount: 1,
    totalAccountsCount: 14,
    avgAccountAgeYears: 4,
    avgAccountAgeMonths: 2,
    oldestAccountCreditor: "ALLY FINCL",
    oldestAccountYear: 2019,
    newestAccountCreditor: "GEMINI/WEBBANK",
    newestAccountYear: 2025,
  } as any);

  // Charge-offs
  await storage.addChargeOff(james.id, {
    creditor: "ALLY FINCL",
    accountType: "Auto Loan",
    originalAmount: 26066,
    balance: 33968,
    openedDate: "2019-06",
    closedDate: "2026-03",
    notes: "",
  });
  await storage.addChargeOff(james.id, {
    creditor: "BK OF AMER",
    accountType: "Credit Card",
    originalAmount: 1926,
    balance: 1926,
    openedDate: "2017-08",
    closedDate: "2026-03",
    notes: "",
  });

  // Collections
  await storage.addCollection(james.id, {
    creditor: "HARRIS & HARRIS LTD",
    originalCreditor: "CHARTER COMMUNICATIONS",
    balance: 719,
    reportedDate: "2026-03",
    notes: "",
  });

  // Late payments
  await storage.addLatePayment(james.id, {
    creditor: "GEMINI/WEBBANK",
    accountType: "Credit Card",
    status: "Open",
    mostRecentLateDate: "2026-03",
    lateHistory: "1x60d 1x90d",
    withinTwelveMonths: true,
    monthsSinceLate: 2,
  } as any);
  await storage.addLatePayment(james.id, {
    creditor: "ALLY FINCL",
    accountType: "Auto Loan",
    status: "Closed",
    mostRecentLateDate: "2024-09",
    lateHistory: "24x90d",
    withinTwelveMonths: false,
    monthsSinceLate: 20,
  } as any);
  await storage.addLatePayment(james.id, {
    creditor: "BK OF AMER",
    accountType: "Credit Card",
    status: "Closed",
    mostRecentLateDate: "2021-09",
    lateHistory: "1+",
    withinTwelveMonths: false,
    monthsSinceLate: 56,
  } as any);

  // Repossession
  await storage.addRepossession(james.id, {
    creditor: "SANTANDER CONSUMER",
    accountType: "Auto Loan",
    originalAmount: 18500,
    balance: 14200,
    openedDate: "2020-04",
    repoDate: "2023-08",
    status: "Repossessed",
    notes: "",
  });

  // Public Record — Tax Lien
  await storage.addPublicRecord(james.id, {
    recordType: "Tax Lien",
    courtOrAgency: "Fulton County Tax Commissioner",
    referenceNumber: "TL-2024-08823",
    amount: 4250,
    status: "Unpaid",
    filedDate: "2024-06",
    notes: "",
  });

  await storage.addCard(james.id, {
    cardName: "Capital One Quicksilver",
    issuer: "Capital One",
    creditLimit: 1500,
    currentBalance: 1320,
    paymentDueDate: "2025-11-08",
    minimumPayment: 45,
    accountStatus: "Current",
    notes: "Near limit",
  });
  await storage.addCard(james.id, {
    cardName: "Discover It",
    issuer: "Discover",
    creditLimit: 2000,
    currentBalance: 1750,
    paymentDueDate: "2025-11-18",
    minimumPayment: 55,
    accountStatus: "Past Due",
    notes: "Past due last month - resolved",
  });
}
