import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const CLIENT_STATUSES = [
  "New",
  "In Progress",
  "Funding Ready",
  "Approved",
  "Paused",
] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CARD_STATUSES = [
  "Current",
  "Past Due",
  "Closed",
  "Charged Off",
] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const FILE_TYPES = [
  "credit_report",
  "bank_statement",
  "business_doc",
  "id_doc",
  "photo",
  "other",
] as const;
export type FileType = (typeof FILE_TYPES)[number];

export const clients = sqliteTable("clients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  address: text("address").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  onboardingDate: text("onboarding_date").notNull().default(""),
  status: text("status").$type<ClientStatus>().notNull().default("New"),
  lastUpdated: text("last_updated").notNull(),

  // Personal Banking
  numBankAccounts: integer("num_bank_accounts").notNull().default(0),
  bankAccountsList: text("bank_accounts_list").notNull().default(""),
  bankAccountsAge: text("bank_accounts_age").notNull().default(""),
  hasSavings: integer("has_savings", { mode: "boolean" }).notNull().default(false),
  hasRetirement401k: integer("has_retirement_401k", { mode: "boolean" }).notNull().default(false),
  recentCreditReport: text("recent_credit_report").notNull().default(""),
  creditUtilization: real("credit_utilization").notNull().default(0),

  // Business
  activeLLC: integer("active_llc", { mode: "boolean" }).notNull().default(false),
  llcName: text("llc_name").notNull().default(""),
  hasBusinessAccounts: integer("has_business_accounts", { mode: "boolean" }).notNull().default(false),
  businessAccountsList: text("business_accounts_list").notNull().default(""),
  businessAccountsAge: text("business_accounts_age").notNull().default(""),
  generatingRevenue: integer("generating_revenue", { mode: "boolean" }).notNull().default(false),
  monthlyRevenue: real("monthly_revenue").notNull().default(0),
  annualRevenue: real("annual_revenue").notNull().default(0),
  hasBusinessProducts: integer("has_business_products", { mode: "boolean" }).notNull().default(false),
  businessCreditCards: text("business_credit_cards").notNull().default(""),
  businessLoans: text("business_loans").notNull().default(""),
  businessLinesOfCredit: text("business_lines_of_credit").notNull().default(""),
  gettingOffersInMail: integer("getting_offers_in_mail", { mode: "boolean" }).notNull().default(false),

  // Notes
  personalNotes: text("personal_notes").notNull().default(""),
  businessNotes: text("business_notes").notNull().default(""),
  internalNotes: text("internal_notes").notNull().default(""),

  // Summary overrides
  fundingReadinessScoreOverride: integer("funding_readiness_score_override"),
  personalBankingStrengthOverride: integer("personal_banking_strength_override"),
  businessBankingStrengthOverride: integer("business_banking_strength_override"),
  creditUtilizationStatusOverride: text("credit_utilization_status_override"),
  businessRevenueStatusOverride: text("business_revenue_status_override"),

  missingDocuments: text("missing_documents").notNull().default("[]"),
  recommendedNextSteps: text("recommended_next_steps").notNull().default(""),

  // Credit Analysis (extracted from credit report)
  creditAnalysisDate: text("credit_analysis_date").notNull().default(""),
  chargeOffsCount: integer("charge_offs_count").notNull().default(0),
  collectionsCount: integer("collections_count").notNull().default(0),
  latePaymentsCount: integer("late_payments_count").notNull().default(0),
  latePaymentsWithin12moCount: integer("late_payments_within_12mo_count").notNull().default(0),
  latePayments12to24moCount: integer("late_payments_12_to_24mo_count").notNull().default(0),
  latePaymentsOlder24moCount: integer("late_payments_older_24mo_count").notNull().default(0),
  repossessionsCount: integer("repossessions_count").notNull().default(0),
  publicRecordsCount: integer("public_records_count").notNull().default(0),
  totalAccountsCount: integer("total_accounts_count").notNull().default(0),
  avgAccountAgeYears: integer("avg_account_age_years").notNull().default(0),
  avgAccountAgeMonths: integer("avg_account_age_months").notNull().default(0),
  oldestAccountCreditor: text("oldest_account_creditor").notNull().default(""),
  oldestAccountYear: integer("oldest_account_year").notNull().default(0),
  newestAccountCreditor: text("newest_account_creditor").notNull().default(""),
  newestAccountYear: integer("newest_account_year").notNull().default(0),
});

export const chargeOffs = sqliteTable("charge_offs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  creditor: text("creditor").notNull().default(""),
  accountType: text("account_type").notNull().default(""),
  originalAmount: real("original_amount").notNull().default(0),
  balance: real("balance").notNull().default(0),
  openedDate: text("opened_date").notNull().default(""),
  closedDate: text("closed_date").notNull().default(""),
  notes: text("notes").notNull().default(""),
});

export const collections = sqliteTable("collections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  creditor: text("creditor").notNull().default(""),
  originalCreditor: text("original_creditor").notNull().default(""),
  balance: real("balance").notNull().default(0),
  reportedDate: text("reported_date").notNull().default(""),
  notes: text("notes").notNull().default(""),
});

export const latePayments = sqliteTable("late_payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  creditor: text("creditor").notNull().default(""),
  accountType: text("account_type").notNull().default(""),
  status: text("status").notNull().default("Open"),
  mostRecentLateDate: text("most_recent_late_date").notNull().default(""),
  lateHistory: text("late_history").notNull().default(""),
  withinTwelveMonths: integer("within_twelve_months", { mode: "boolean" }).notNull().default(false),
  // Months since most recent late payment, used to bucket into 3 ranges
  monthsSinceLate: integer("months_since_late").notNull().default(0),
});

export const repossessions = sqliteTable("repossessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  creditor: text("creditor").notNull().default(""),
  accountType: text("account_type").notNull().default(""),
  originalAmount: real("original_amount").notNull().default(0),
  balance: real("balance").notNull().default(0),
  openedDate: text("opened_date").notNull().default(""),
  repoDate: text("repo_date").notNull().default(""),
  status: text("status").notNull().default(""),
  notes: text("notes").notNull().default(""),
});

export const PUBLIC_RECORD_TYPES = [
  "Bankruptcy",
  "Judgment",
  "Foreclosure",
  "Tax Lien",
  "Other",
] as const;
export type PublicRecordType = (typeof PUBLIC_RECORD_TYPES)[number];

export const publicRecords = sqliteTable("public_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  recordType: text("record_type").$type<PublicRecordType>().notNull().default("Other"),
  courtOrAgency: text("court_or_agency").notNull().default(""),
  referenceNumber: text("reference_number").notNull().default(""),
  amount: real("amount").notNull().default(0),
  status: text("status").notNull().default(""),
  filedDate: text("filed_date").notNull().default(""),
  notes: text("notes").notNull().default(""),
});

export const creditCards = sqliteTable("credit_cards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  cardName: text("card_name").notNull().default(""),
  issuer: text("issuer").notNull().default(""),
  creditLimit: real("credit_limit").notNull().default(0),
  currentBalance: real("current_balance").notNull().default(0),
  paymentDueDate: text("payment_due_date").notNull().default(""),
  minimumPayment: real("minimum_payment").notNull().default(0),
  accountStatus: text("account_status").$type<CardStatus>().notNull().default("Current"),
  notes: text("notes").notNull().default(""),
});

export const uploadedFiles = sqliteTable("uploaded_files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").$type<FileType>().notNull().default("other"),
  uploadedAt: text("uploaded_at").notNull(),
  fileSize: integer("file_size").notNull().default(0),
  base64Content: text("base64_content").notNull().default(""),
});

export const insertClientSchema = createInsertSchema(clients).omit({
  id: true,
  lastUpdated: true,
});

export const updateClientSchema = insertClientSchema.partial();

export const insertCreditCardSchema = createInsertSchema(creditCards).omit({
  id: true,
});

export const updateCreditCardSchema = insertCreditCardSchema.partial();

export const insertUploadedFileSchema = createInsertSchema(uploadedFiles).omit({
  id: true,
  uploadedAt: true,
});

export const insertChargeOffSchema = createInsertSchema(chargeOffs).omit({ id: true });
export const insertCollectionSchema = createInsertSchema(collections).omit({ id: true });
export const insertLatePaymentSchema = createInsertSchema(latePayments).omit({ id: true });
export const insertRepossessionSchema = createInsertSchema(repossessions).omit({ id: true });
export const insertPublicRecordSchema = createInsertSchema(publicRecords).omit({ id: true });

export type Client = typeof clients.$inferSelect;
export type InsertClient = z.infer<typeof insertClientSchema>;
export type UpdateClient = z.infer<typeof updateClientSchema>;

export type CreditCard = typeof creditCards.$inferSelect;
export type InsertCreditCard = z.infer<typeof insertCreditCardSchema>;
export type UpdateCreditCard = z.infer<typeof updateCreditCardSchema>;

export type UploadedFile = typeof uploadedFiles.$inferSelect;
export type InsertUploadedFile = z.infer<typeof insertUploadedFileSchema>;

export type ChargeOff = typeof chargeOffs.$inferSelect;
export type InsertChargeOff = z.infer<typeof insertChargeOffSchema>;
export type Collection = typeof collections.$inferSelect;
export type InsertCollection = z.infer<typeof insertCollectionSchema>;
export type LatePayment = typeof latePayments.$inferSelect;
export type InsertLatePayment = z.infer<typeof insertLatePaymentSchema>;
export type Repossession = typeof repossessions.$inferSelect;
export type InsertRepossession = z.infer<typeof insertRepossessionSchema>;
export type PublicRecord = typeof publicRecords.$inferSelect;
export type InsertPublicRecord = z.infer<typeof insertPublicRecordSchema>;

export type ClientWithDetails = Client & {
  creditCards: CreditCard[];
  files: UploadedFile[];
};

export type CreditAnalysis = {
  client: Client;
  chargeOffs: ChargeOff[];
  collections: Collection[];
  latePayments: LatePayment[];
  repossessions: Repossession[];
  publicRecords: PublicRecord[];
};
