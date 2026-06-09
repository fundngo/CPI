import jsPDF from "jspdf";
import type {
  ClientWithDetails,
  ChargeOff,
  Collection,
  LatePayment,
  Repossession,
  PublicRecord,
} from "@shared/schema";

export interface CreditAnalysisPayload {
  chargeOffs: ChargeOff[];
  collections: Collection[];
  latePayments: LatePayment[];
  repossessions: Repossession[];
  publicRecords: PublicRecord[];
}
import logoUrl from "@/assets/fund-go-logo.png";
import {
  autoRecommendedSteps,
  businessBankingStrength,
  businessRevenueStatus,
  cardUtilization,
  fmtCurrency,
  fmtDate,
  fmtPct,
  fundingReadinessScore,
  overallUtilization,
  parseMissingDocs,
  paydownTo,
  personalBankingStrength,
  readinessLabel,
  targetBalanceAt,
  totalBalance,
  totalCreditLimit,
  utilBucket,
  utilizationStatus,
} from "./calculations";

// Hex → [r,g,b] for jsPDF (which only accepts numeric color triples).
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const BUCKET_TEXT: Record<"green" | "yellow" | "red", [number, number, number]> = {
  green: hexToRgb("#16a34a"),
  yellow: hexToRgb("#d97706"),
  red: hexToRgb("#dc2626"),
};
const BUCKET_TINT: Record<"green" | "yellow" | "red", [number, number, number]> = {
  green: hexToRgb("#ecfdf5"),
  yellow: hexToRgb("#fffbeb"),
  red: hexToRgb("#fef2f2"),
};

export function generateClientPdf(
  client: ClientWithDetails,
  credit?: CreditAnalysisPayload,
) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const margin = 48;
  let y = margin;

  const navy: [number, number, number] = [20, 38, 76];
  const slate: [number, number, number] = [100, 110, 130];
  const emerald: [number, number, number] = [40, 158, 110];
  const muted: [number, number, number] = [240, 242, 247];

  function ensure(space: number) {
    if (y + space > H - margin) {
      doc.addPage();
      y = margin;
    }
  }

  // Brand header with logo
  doc.setFillColor(...navy);
  doc.rect(0, 0, W, 72, "F");
  doc.setTextColor(255, 255, 255);
  // Logo (PNG) — aspect-preserved height ~40pt, left-aligned in header
  try {
    doc.addImage(logoUrl, "PNG", margin, 16, 160, 40, undefined, "FAST");
  } catch {
    // Fallback to text if image fails
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Get You Right Consulting", margin, 32);
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Client Profile Intake — Confidential", W - margin, 32, { align: "right" });
  doc.text(`Generated ${new Date().toLocaleDateString()}`, W - margin, 50, { align: "right" });

  y = 96;
  doc.setTextColor(20, 38, 76);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(client.name, margin, y);
  y += 22;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...slate);
  if ((client as any).address) {
    const addrLines = doc.splitTextToSize(String((client as any).address), W - margin * 2);
    doc.text(addrLines, margin, y);
    y += addrLines.length * 12 + 2;
  }
  const contact = [client.phone, client.email].filter(Boolean).join("  ·  ");
  if (contact) {
    doc.text(contact, margin, y);
    y += 14;
  }
  doc.text(`Status: ${client.status}   |   Onboarded: ${fmtDate(client.onboardingDate)}   |   Updated: ${fmtDate(client.lastUpdated)}`, margin, y);
  y += 18;

  // Summary box
  const score = fundingReadinessScore(client);
  const { label: scoreLabel } = readinessLabel(score);
  const util = overallUtilization(client.creditCards);
  const pbs = personalBankingStrength(client);
  const bbs = businessBankingStrength(client);

  // Summary box — 4 evenly distributed columns inside the grey card
  const boxW = W - margin * 2;
  const colW = boxW / 4;
  const colX = (i: number) => margin + colW * i + 16; // 16pt inset from each column edge
  doc.setDrawColor(220, 224, 232);
  doc.setFillColor(...muted);
  doc.roundedRect(margin, y, boxW, 88, 6, 6, "FD");

  doc.setTextColor(...slate);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("FUNDING READINESS", colX(0), y + 22);
  doc.text("PERSONAL BANKING", colX(1), y + 22);
  doc.text("BUSINESS BANKING", colX(2), y + 22);
  doc.text("OVERALL UTILIZATION", colX(3), y + 22);

  doc.setTextColor(...navy);
  doc.setFontSize(22);
  doc.text(`${score}`, colX(0), y + 52);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...slate);
  doc.text(scoreLabel, colX(0), y + 70);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...navy);
  const pbsX = colX(1);
  doc.text(`${pbs}`, pbsX, y + 52);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...slate);
  doc.text("/ 100", pbsX + 30, y + 52);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...navy);
  const bbsX = colX(2);
  doc.text(`${bbs}`, bbsX, y + 52);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...slate);
  doc.text("/ 100", bbsX + 30, y + 52);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(util >= 50 ? 200 : util >= 30 ? 220 : 40, util >= 50 ? 50 : util >= 30 ? 140 : 158, util >= 50 ? 50 : util >= 30 ? 30 : 110);
  doc.text(`${util.toFixed(0)}%`, colX(3), y + 52);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...slate);
  doc.text(utilizationStatus(util), colX(3), y + 70);

  y += 108;

  function sectionHeader(title: string) {
    ensure(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...navy);
    doc.text(title, margin, y);
    // Underline spans the full width of the title text
    const titleWidth = doc.getTextWidth(title);
    y += 6;
    doc.setDrawColor(...emerald);
    doc.setLineWidth(2);
    doc.line(margin, y, margin + titleWidth, y);
    doc.setLineWidth(1);
    y += 14;
    doc.setTextColor(...slate);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
  }

  function kvLine(k: string, v: string) {
    ensure(16);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...navy);
    doc.text(k, margin, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 70, 90);
    const lines = doc.splitTextToSize(v || "—", W - margin * 2 - 150);
    doc.text(lines, margin + 150, y);
    y += Math.max(14, lines.length * 12);
  }

  sectionHeader("Personal Banking");
  kvLine("Bank Accounts", `${client.numBankAccounts} accounts`);
  kvLine("Accounts List", client.bankAccountsList);
  kvLine("Account Age", client.bankAccountsAge);
  kvLine("Has Savings", client.hasSavings ? "Yes" : "No");
  kvLine("Has Retirement / 401(k)", client.hasRetirement401k ? "Yes" : "No");
  // Show all bureaus separately when available
  const triBureauLines: string[] = [];
  if (client.equifaxScore != null) triBureauLines.push(`Equifax ${client.equifaxScore}`);
  if (client.experianScore != null) triBureauLines.push(`Experian ${client.experianScore}`);
  if (client.transunionScore != null) triBureauLines.push(`TransUnion ${client.transunionScore}`);
  if (triBureauLines.length > 0) {
    kvLine("Credit Report", triBureauLines.join("  \u2022  "));
  } else if (client.recentCreditReport) {
    kvLine("Credit Report", client.recentCreditReport);
  }
  if (client.personalNotes) kvLine("Notes", client.personalNotes);
  y += 8;

  sectionHeader("Business");
  kvLine("Active LLC", client.activeLLC ? `Yes — ${client.llcName || "(unnamed)"}` : "No");
  kvLine("Business Accounts", client.hasBusinessAccounts ? client.businessAccountsList || "Yes" : "No");
  kvLine("Account Age", client.businessAccountsAge);
  kvLine("Generating Revenue", client.generatingRevenue ? "Yes" : "No");
  kvLine("Monthly Revenue", fmtCurrency(client.monthlyRevenue));
  kvLine("Annual Revenue", fmtCurrency(client.annualRevenue));
  kvLine("Revenue Status", businessRevenueStatus(client.monthlyRevenue));
  kvLine("Business Credit Cards", client.businessCreditCards);
  kvLine("Business Loans", client.businessLoans);
  kvLine("Lines of Credit", client.businessLinesOfCredit);
  kvLine("Getting Offers in Mail", client.gettingOffersInMail ? "Yes" : "No");
  if (client.businessNotes) kvLine("Notes", client.businessNotes);
  y += 8;

  sectionHeader("Credit Utilization");
  kvLine("Total Cards", `${client.creditCards.length}`);
  kvLine("Total Credit Limit", fmtCurrency(totalCreditLimit(client.creditCards)));
  kvLine("Total Balance", fmtCurrency(totalBalance(client.creditCards)));
  kvLine("Overall Utilization", `${fmtPct(util, 1)} (${utilizationStatus(util)})`);
  y += 4;

  if (client.creditCards.length) {
    // Color-code legend (ASCII only — helvetica WinAnsi mangles ≤ and –)
    y += 6;
    ensure(20);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...slate);
    const legendY = y;
    function legendDot(x: number, label: string, fill: [number, number, number]) {
      doc.setFillColor(...fill);
      doc.circle(x + 3, legendY - 2.5, 2.5, "F");
      doc.text(label, x + 9, legendY);
    }
    legendDot(margin, "Under 15% - Good", BUCKET_TEXT.green);
    legendDot(margin + 130, "15-30% - Watch", BUCKET_TEXT.yellow);
    legendDot(margin + 250, "Over 30% - Over target", BUCKET_TEXT.red);
    y += 16;

    ensure(36);
    // Simplified 7-column layout — just show LIMIT, BAL, UTIL, and the two
    // balance targets so clients see the max they can carry, not paydown math.
    // Page usable width is 516pt; right-align rightmost columns and keep a
    // generous gap between 30% / 15% so "BALANCE" headers fit without crowding.
    const colCard = margin;
    const colIssuer = margin + 100;
    const colLimit = margin + 240;
    const colBalance = margin + 300;
    const colUtil = margin + 350;
    const colT30 = margin + 425;        // gap of 75pt to UTIL
    const colT15 = W - margin;          // ends at right edge; gap of ~91pt to T30
    // Soft, eye-friendly target colors
    const LIGHT_AMBER: [number, number, number] = [224, 169, 58];
    const LIGHT_GREEN: [number, number, number] = [107, 191, 107];

    // Header row
    doc.setFillColor(...muted);
    doc.rect(margin, y - 10, W - margin * 2, 18, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...slate);
    doc.text("CARD", colCard, y);
    doc.text("ISSUER", colIssuer, y);
    doc.text("LIMIT", colLimit, y, { align: "right" });
    doc.text("BAL", colBalance, y, { align: "right" });
    doc.text("UTIL", colUtil, y, { align: "right" });
    doc.setTextColor(...LIGHT_AMBER);
    doc.text("30% BALANCE", colT30, y, { align: "right" });
    doc.setTextColor(...LIGHT_GREEN);
    doc.text("15% BALANCE", colT15, y, { align: "right" });
    doc.setTextColor(...slate);
    y += 8;
    doc.setDrawColor(220, 224, 232);
    doc.line(margin, y, W - margin, y);
    y += 12;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    let totLimit = 0;
    let totBal = 0;
    let totT30 = 0;
    let totT15 = 0;
    for (const card of client.creditCards) {
      ensure(16);
      const util = cardUtilization(card);
      const bucket = utilBucket(util);
      const t30 = targetBalanceAt(card.creditLimit, 30);
      const t15 = targetBalanceAt(card.creditLimit, 15);

      // tinted row background + colored left bar
      doc.setFillColor(...BUCKET_TINT[bucket]);
      doc.rect(margin, y - 10, W - margin * 2, 16, "F");
      doc.setFillColor(...BUCKET_TEXT[bucket]);
      doc.rect(margin, y - 10, 3, 16, "F");

      doc.setTextColor(40, 50, 70);
      // Hard-truncate to fit columns — issuer must not overflow into the
      // right-aligned LIMIT column. Available width for issuer ~ 110pt with
      // an 8pt safety gap before the LIMIT figure starts.
      function truncateToWidth(text: string, maxW: number): string {
        let s = text;
        if (doc.getTextWidth(s) <= maxW) return s;
        while (s.length > 1 && doc.getTextWidth(s + "\u2026") > maxW) {
          s = s.slice(0, -1);
        }
        return s + "\u2026";
      }
      const cardNameText = truncateToWidth(card.cardName || "—", 88);
      const issuerText = truncateToWidth(card.issuer || "—", 110);
      doc.text(cardNameText, colCard + 5, y);
      doc.text(issuerText, colIssuer, y);
      doc.text(fmtCurrency(card.creditLimit), colLimit, y, { align: "right" });
      doc.text(fmtCurrency(card.currentBalance), colBalance, y, { align: "right" });

      // util in bucket color, bold
      doc.setTextColor(...BUCKET_TEXT[bucket]);
      doc.setFont("helvetica", "bold");
      doc.text(`${util.toFixed(0)}%`, colUtil, y, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setTextColor(40, 50, 70);

      // 30% target in light amber, 15% target in light green
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...LIGHT_AMBER);
      doc.text(fmtCurrency(t30), colT30, y, { align: "right" });
      doc.setTextColor(...LIGHT_GREEN);
      doc.text(fmtCurrency(t15), colT15, y, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setTextColor(40, 50, 70);

      totLimit += card.creditLimit || 0;
      totBal += card.currentBalance || 0;
      totT30 += t30;
      totT15 += t15;
      y += 16;
    }

    // Totals row
    ensure(18);
    doc.setFillColor(...muted);
    doc.rect(margin, y - 10, W - margin * 2, 18, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...navy);
    doc.text("TOTALS", colCard + 5, y);
    doc.text(fmtCurrency(totLimit), colLimit, y, { align: "right" });
    doc.text(fmtCurrency(totBal), colBalance, y, { align: "right" });
    doc.text(`${overallUtilization(client.creditCards).toFixed(1)}%`, colUtil, y, { align: "right" });
    doc.setTextColor(...LIGHT_AMBER);
    doc.text(fmtCurrency(totT30), colT30, y, { align: "right" });
    doc.setTextColor(...LIGHT_GREEN);
    doc.text(fmtCurrency(totT15), colT15, y, { align: "right" });
    doc.setTextColor(40, 50, 70);
    doc.setFont("helvetica", "normal");
    y += 18;
  }
  y += 8;

  const missing = parseMissingDocs(client.missingDocuments);
  if (missing.length) {
    sectionHeader("Missing Documents");
    for (const m of missing) {
      ensure(14);
      doc.text(`•  ${m}`, margin, y);
      y += 14;
    }
    y += 4;
  }

  const steps = autoRecommendedSteps(client);
  if (steps.length || client.recommendedNextSteps) {
    sectionHeader("Recommended Next Steps");
    for (const s of steps) {
      ensure(14);
      // Use a plain ASCII bullet — jsPDF default helvetica (WinAnsi) mangles the
      // U+2192 arrow into garbled glyphs like "I'".
      const lines = doc.splitTextToSize(`•  ${s}`, W - margin * 2);
      doc.text(lines, margin, y);
      y += lines.length * 14;
    }
    if (client.recommendedNextSteps) {
      y += 4;
      ensure(14);
      doc.setFont("helvetica", "bold");
      doc.text("Custom notes:", margin, y);
      y += 14;
      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(client.recommendedNextSteps, W - margin * 2);
      doc.text(lines, margin, y);
      y += lines.length * 12;
    }
    y += 4;
  }

  if (client.internalNotes) {
    sectionHeader("Internal Notes");
    const lines = doc.splitTextToSize(client.internalNotes, W - margin * 2);
    doc.text(lines, margin, y);
    y += lines.length * 12;
  }

  // ====== PAGE 2: CREDIT ANALYSIS REPORT ======
  if (credit) {
    renderCreditAnalysisPage(
      doc,
      client,
      credit,
      { W, H, margin, navy, slate, muted },
    );
  }

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...slate);
    doc.text(
      `Get You Right Consulting · Client Profile · Page ${i} of ${pageCount}`,
      W / 2,
      H - 24,
      { align: "center" }
    );
  }

  const safe = client.name.replace(/[^a-z0-9]+/gi, "_");
  doc.save(`CPI_${safe}.pdf`);
}

// ============================================================================
// PAGE 2: Credit Analysis Report — derogs, collections, late payments, etc.
// ============================================================================
function renderCreditAnalysisPage(
  doc: jsPDF,
  client: ClientWithDetails,
  credit: CreditAnalysisPayload,
  ctx: {
    W: number;
    H: number;
    margin: number;
    navy: [number, number, number];
    slate: [number, number, number];
    muted: [number, number, number];
  },
) {
  const { W, H, margin, navy, slate, muted } = ctx;
  const red: [number, number, number] = [220, 38, 38];
  doc.addPage();
  let y = margin;

  function ensure(space: number) {
    if (y + space > H - margin) {
      doc.addPage();
      y = margin;
    }
  }

  // ---- Title bar ----
  doc.setFillColor(...navy);
  doc.rect(0, 0, W, 56, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Credit Analysis Report", margin, 36);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(client.name, W - margin, 36, { align: "right" });
  y = 80;

  // ---- KPI summary cards (2 rows) ----
  function kpiCard(
    x: number,
    cy: number,
    cw: number,
    label: string,
    value: string,
    sub: string,
    isNegative: boolean,
  ) {
    doc.setFillColor(...muted);
    doc.rect(x, cy, cw, 56, "F");
    if (isNegative) {
      doc.setFillColor(...red);
      doc.rect(x, cy, 3, 56, "F");
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...slate);
    doc.text(label.toUpperCase(), x + 10, cy + 14);
    doc.setFontSize(20);
    doc.setTextColor(...(isNegative ? red : navy));
    doc.text(value, x + 10, cy + 36);
    if (sub) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...slate);
      doc.text(sub, x + 10, cy + 50);
    }
  }

  const cardW = (W - margin * 2 - 12 * 3) / 4;
  const ageStr =
    (client.avgAccountAgeYears || 0) === 0 && (client.avgAccountAgeMonths || 0) === 0
      ? "—"
      : `${client.avgAccountAgeYears}y ${client.avgAccountAgeMonths}m`;

  kpiCard(
    margin,
    y,
    cardW,
    "Charge-Offs",
    String(client.chargeOffsCount),
    "",
    client.chargeOffsCount > 0,
  );
  kpiCard(
    margin + (cardW + 12),
    y,
    cardW,
    "Collections",
    String(client.collectionsCount),
    "",
    client.collectionsCount > 0,
  );
  kpiCard(
    margin + (cardW + 12) * 2,
    y,
    cardW,
    "Late Payments",
    String(client.latePaymentsCount),
    "",
    client.latePaymentsCount > 0,
  );
  kpiCard(
    margin + (cardW + 12) * 3,
    y,
    cardW,
    "Avg Account Age",
    ageStr,
    `${client.totalAccountsCount} total accounts`,
    false,
  );
  y += 64;

  // Row 2: Repossessions, Public Records (just 2 cards left-aligned)
  kpiCard(
    margin,
    y,
    cardW,
    "Repossessions",
    String(client.repossessionsCount),
    "",
    client.repossessionsCount > 0,
  );
  kpiCard(
    margin + (cardW + 12),
    y,
    cardW,
    "Public Records",
    String(client.publicRecordsCount),
    "",
    client.publicRecordsCount > 0,
  );
  y += 72;

  // ---- Credit Age Overview ----
  doc.setFillColor(...muted);
  doc.rect(margin, y, W - margin * 2, 56, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...navy);
  doc.text("Credit Age Overview", margin + 12, y + 16);

  const col1X = margin + 12;
  const col2X = margin + (W - margin * 2) / 3;
  const col3X = margin + ((W - margin * 2) * 2) / 3;

  function ageLabel(lx: number, label: string, value: string) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...slate);
    doc.text(label.toUpperCase(), lx, y + 32);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...navy);
    doc.text(value, lx, y + 48);
  }
  ageLabel(
    col1X,
    "Oldest Account",
    `${client.oldestAccountCreditor || "—"}${client.oldestAccountYear ? ` (${client.oldestAccountYear})` : ""}`,
  );
  ageLabel(
    col2X,
    "Newest Account",
    `${client.newestAccountCreditor || "—"}${client.newestAccountYear ? ` (${client.newestAccountYear})` : ""}`,
  );
  ageLabel(col3X, "Accounts Found", String(client.totalAccountsCount));
  y += 72;

  // ---- Helper: render a data table ----
  function fmtMoney(v: number | null | undefined): string {
    if (v == null || Number.isNaN(v)) return "—";
    return `$${Number(v).toLocaleString()}`;
  }

  function renderTable<T extends Record<string, unknown>>(
    title: string,
    count: number,
    columns: Array<{ header: string; render: (row: T) => string; width: number }>,
    rows: T[],
  ) {
    if (rows.length === 0) return;
    ensure(60);
    // Heading bar
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...navy);
    doc.text(title, margin, y);
    // Count badge
    const titleW = doc.getTextWidth(title);
    doc.setFillColor(...red);
    doc.roundedRect(margin + titleW + 8, y - 10, 18, 14, 7, 7, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.text(String(count), margin + titleW + 8 + 9, y, { align: "center" });
    y += 12;

    // Column header row
    doc.setFillColor(...muted);
    doc.rect(margin, y, W - margin * 2, 18, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...slate);
    let x = margin + 8;
    for (const col of columns) {
      doc.text(col.header, x, y + 12);
      x += col.width;
    }
    y += 18;

    // Data rows
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(40, 50, 70);
    for (const row of rows) {
      ensure(16);
      let cx = margin + 8;
      for (const col of columns) {
        const text = col.render(row) || "—";
        const lines = doc.splitTextToSize(text, col.width - 6);
        doc.text(lines[0] || "", cx, y + 11);
        cx += col.width;
      }
      // Subtle row separator
      doc.setDrawColor(230, 232, 240);
      doc.setLineWidth(0.3);
      doc.line(margin, y + 16, W - margin, y + 16);
      y += 16;
    }
    y += 10;
  }

  // ---- Repossessions ----
  const totalW = W - margin * 2 - 16;
  renderTable<Repossession>(
    "Repossessions",
    credit.repossessions.length,
    [
      { header: "CREDITOR", render: (r) => r.creditor, width: totalW * 0.22 },
      { header: "TYPE", render: (r) => r.accountType || "—", width: totalW * 0.16 },
      { header: "ORIGINAL", render: (r) => fmtMoney(r.originalAmount), width: totalW * 0.16 },
      { header: "BALANCE", render: (r) => fmtMoney(r.balance), width: totalW * 0.16 },
      { header: "OPENED", render: (r) => r.openedDate || "—", width: totalW * 0.14 },
      { header: "REPO DATE", render: (r) => r.repoDate || "—", width: totalW * 0.16 },
    ],
    credit.repossessions,
  );

  // ---- Charge-Offs ----
  renderTable<ChargeOff>(
    "Charge-Off Accounts",
    credit.chargeOffs.length,
    [
      { header: "CREDITOR", render: (r) => r.creditor, width: totalW * 0.22 },
      { header: "TYPE", render: (r) => r.accountType, width: totalW * 0.16 },
      { header: "ORIGINAL", render: (r) => fmtMoney(r.originalAmount), width: totalW * 0.16 },
      { header: "BALANCE", render: (r) => fmtMoney(r.balance), width: totalW * 0.16 },
      { header: "OPENED", render: (r) => r.openedDate || "—", width: totalW * 0.14 },
      { header: "CLOSED", render: (r) => r.closedDate || "—", width: totalW * 0.16 },
    ],
    credit.chargeOffs,
  );

  // ---- Collections ----
  renderTable<Collection>(
    "Collections",
    credit.collections.length,
    [
      { header: "CREDITOR", render: (r) => r.creditor, width: totalW * 0.28 },
      { header: "ORIGINAL CREDITOR", render: (r) => r.originalCreditor || "—", width: totalW * 0.28 },
      { header: "BALANCE", render: (r) => fmtMoney(r.balance), width: totalW * 0.22 },
      { header: "REPORTED", render: (r) => r.reportedDate || "—", width: totalW * 0.22 },
    ],
    credit.collections,
  );

  // ---- Late Payments — bucket by recency ----
  const within12: LatePayment[] = [];
  const between12And24: LatePayment[] = [];
  const olderCombined: LatePayment[] = [];
  for (const lp of credit.latePayments) {
    if (lp.withinTwelveMonths) within12.push(lp);
    else if ((lp.monthsSinceLate ?? 99) <= 24) between12And24.push(lp);
    else olderCombined.push(lp);
  }

  const lateCols = [
    { header: "CREDITOR", render: (r: LatePayment) => r.creditor, width: totalW * 0.22 },
    { header: "TYPE", render: (r: LatePayment) => r.accountType, width: totalW * 0.18 },
    { header: "STATUS", render: (r: LatePayment) => r.status, width: totalW * 0.18 },
    { header: "MOST RECENT", render: (r: LatePayment) => r.mostRecentLateDate || "—", width: totalW * 0.18 },
    { header: "HISTORY", render: (r: LatePayment) => r.lateHistory || "—", width: totalW * 0.24 },
  ];

  renderTable<LatePayment>(
    "Late Payments — Within 12 Months",
    within12.length,
    lateCols,
    within12,
  );
  renderTable<LatePayment>(
    "Late Payments — 12 to 24 Months",
    between12And24.length,
    lateCols,
    between12And24,
  );
  renderTable<LatePayment>(
    "Late Payments — Over 24 Months",
    olderCombined.length,
    lateCols,
    olderCombined,
  );

  // ---- Public Records ----
  renderTable<PublicRecord>(
    "Public Records",
    credit.publicRecords.length,
    [
      { header: "TYPE", render: (r) => r.recordType, width: totalW * 0.2 },
      { header: "COURT / AGENCY", render: (r) => r.courtOrAgency || "—", width: totalW * 0.24 },
      { header: "REFERENCE #", render: (r) => r.referenceNumber || "—", width: totalW * 0.18 },
      { header: "AMOUNT", render: (r) => (r.amount > 0 ? fmtMoney(r.amount) : "—"), width: totalW * 0.14 },
      { header: "STATUS", render: (r) => r.status || "—", width: totalW * 0.12 },
      { header: "FILED", render: (r) => r.filedDate || "—", width: totalW * 0.12 },
    ],
    credit.publicRecords,
  );
}
