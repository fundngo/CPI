import jsPDF from "jspdf";
import type { ClientWithDetails } from "@shared/schema";
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

export function generateClientPdf(client: ClientWithDetails) {
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

  // Brand header
  doc.setFillColor(...navy);
  doc.rect(0, 0, W, 72, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Get You Right Consulting", margin, 32);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Client Profile Intake — Confidential", margin, 50);
  doc.setFontSize(9);
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
    y += 6;
    doc.setDrawColor(...emerald);
    doc.setLineWidth(2);
    doc.line(margin, y, margin + 40, y);
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
  kvLine("Credit Report", client.recentCreditReport);
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
    // Color-code legend
    ensure(16);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...slate);
    const legendY = y;
    function legendDot(x: number, label: string, fill: [number, number, number]) {
      doc.setFillColor(...fill);
      doc.circle(x + 3, legendY - 2.5, 2.5, "F");
      doc.text(label, x + 9, legendY);
    }
    legendDot(margin, "≤ 15% Good", BUCKET_TEXT.green);
    legendDot(margin + 110, "15.01–30% Watch", BUCKET_TEXT.yellow);
    legendDot(margin + 240, "> 30% Over target", BUCKET_TEXT.red);
    y += 14;

    ensure(36);
    // 9-column layout for CPI sheet (page usable width 516pt with 48pt margins):
    // CARD (left)        : margin .. margin+92
    // ISSUER (left)      : margin+98 .. margin+178
    // LIMIT (right)      : margin+236
    // BALANCE (right)    : margin+296
    // UTIL (right)       : margin+340
    // TARGET 30 (right)  : margin+390
    // TARGET 15 (right)  : margin+440
    // PAYDOWN 30 (right) : margin+498
    // STATUS dropped to keep things readable in PDF (still in app)
    const colCard = margin;
    const colIssuer = margin + 98;
    const colLimit = margin + 236;
    const colBalance = margin + 296;
    const colUtil = margin + 340;
    const colT30 = margin + 390;
    const colT15 = margin + 440;
    const colPay = margin + 498;

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
    doc.text("TGT 30%", colT30, y, { align: "right" });
    doc.text("TGT 15%", colT15, y, { align: "right" });
    doc.text("PAYDOWN", colPay, y, { align: "right" });
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
    let totPay30 = 0;
    for (const card of client.creditCards) {
      ensure(16);
      const util = cardUtilization(card);
      const bucket = utilBucket(util);
      const t30 = targetBalanceAt(card.creditLimit, 30);
      const t15 = targetBalanceAt(card.creditLimit, 15);
      const p30 = paydownTo(card.currentBalance, card.creditLimit, 30);

      // tinted row background + colored left bar
      doc.setFillColor(...BUCKET_TINT[bucket]);
      doc.rect(margin, y - 10, W - margin * 2, 16, "F");
      doc.setFillColor(...BUCKET_TEXT[bucket]);
      doc.rect(margin, y - 10, 3, 16, "F");

      doc.setTextColor(40, 50, 70);
      const cardName = doc.splitTextToSize(card.cardName || "—", 86);
      const issuer = doc.splitTextToSize(card.issuer || "—", 130);
      doc.text(cardName[0], colCard + 5, y);
      doc.text(issuer[0], colIssuer, y);
      doc.text(fmtCurrency(card.creditLimit), colLimit, y, { align: "right" });
      doc.text(fmtCurrency(card.currentBalance), colBalance, y, { align: "right" });

      // util in bucket color, bold
      doc.setTextColor(...BUCKET_TEXT[bucket]);
      doc.setFont("helvetica", "bold");
      doc.text(`${util.toFixed(0)}%`, colUtil, y, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setTextColor(40, 50, 70);

      doc.text(fmtCurrency(t30), colT30, y, { align: "right" });
      doc.text(fmtCurrency(t15), colT15, y, { align: "right" });

      if (p30 > 0) {
        doc.setTextColor(...BUCKET_TEXT[bucket]);
        doc.setFont("helvetica", "bold");
        doc.text(fmtCurrency(p30), colPay, y, { align: "right" });
        doc.setFont("helvetica", "normal");
        doc.setTextColor(40, 50, 70);
      } else {
        doc.setTextColor(...BUCKET_TEXT.green);
        doc.text("On target", colPay, y, { align: "right" });
        doc.setTextColor(40, 50, 70);
      }

      totLimit += card.creditLimit || 0;
      totBal += card.currentBalance || 0;
      totT30 += t30;
      totT15 += t15;
      totPay30 += p30;
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
    doc.text(fmtCurrency(totT30), colT30, y, { align: "right" });
    doc.text(fmtCurrency(totT15), colT15, y, { align: "right" });
    if (totPay30 > 0) {
      doc.setTextColor(...BUCKET_TEXT.red);
      doc.text(fmtCurrency(totPay30), colPay, y, { align: "right" });
    } else {
      doc.setTextColor(...BUCKET_TEXT.green);
      doc.text("On target", colPay, y, { align: "right" });
    }
    doc.setFont("helvetica", "normal");
    doc.setTextColor(40, 50, 70);
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
