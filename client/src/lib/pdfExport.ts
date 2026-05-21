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
  personalBankingStrength,
  readinessLabel,
  totalBalance,
  totalCreditLimit,
  utilizationStatus,
} from "./calculations";

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
    ensure(24);
    // Column layout (pt), tuned so issuer text doesn't collide with limit:
    // CARD: margin .. margin+140 (left)
    // ISSUER: margin+150 .. margin+260 (left)
    // LIMIT: right-aligned at margin+320
    // BALANCE: right-aligned at margin+380
    // UTIL: right-aligned at margin+420
    // STATUS: left at margin+440
    const cardCol = margin;
    const issuerCol = margin + 150;
    const issuerMaxW = 100; // 150..250 area; right edge ~260 before LIMIT right-aligns at 320
    const limitCol = margin + 320;
    const balanceCol = margin + 380;
    const utilCol = margin + 425;
    const statusCol = margin + 445;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...slate);
    doc.text("CARD", cardCol, y);
    doc.text("ISSUER", issuerCol, y);
    doc.text("LIMIT", limitCol, y, { align: "right" });
    doc.text("BALANCE", balanceCol, y, { align: "right" });
    doc.text("UTIL", utilCol, y, { align: "right" });
    doc.text("STATUS", statusCol, y);
    y += 6;
    doc.setDrawColor(220, 224, 232);
    doc.line(margin, y, W - margin, y);
    y += 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(40, 50, 70);
    for (const card of client.creditCards) {
      ensure(16);
      const cardName = doc.splitTextToSize(card.cardName || "—", 140);
      const issuer = doc.splitTextToSize(card.issuer || "—", issuerMaxW);
      doc.text(cardName[0], cardCol, y);
      doc.text(issuer[0], issuerCol, y);
      doc.text(fmtCurrency(card.creditLimit), limitCol, y, { align: "right" });
      doc.text(fmtCurrency(card.currentBalance), balanceCol, y, { align: "right" });
      doc.text(`${cardUtilization(card).toFixed(0)}%`, utilCol, y, { align: "right" });
      doc.text(card.accountStatus, statusCol, y);
      y += 14;
    }
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
