import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCreditReport, buildCreditReportPatch, toChildTables } from "../server/extraction";

const raw = {
  name: "JOHN DOE",
  address: "123 Main St, Anytown ST 12345",
  bureauScores: { equifax: 702, experian: "691", transunion: 9999 },
  creditScore: null,
  creditCards: [
    { cardName: "Freedom", issuer: "Chase", creditLimit: "$10,000", currentBalance: 4000, accountStatus: "Current" },
    { cardName: "Old", issuer: "Citi", creditLimit: 5000, currentBalance: 5000, accountStatus: "Charged Off" },
    { cardName: "Weird", issuer: "X", creditLimit: 1000, currentBalance: 0, accountStatus: "Something" },
  ],
  latePayments: [
    { creditor: "A", mostRecentLateDate: "2020-01", withinTwelveMonths: true, monthsSinceLate: 0 },
    { creditor: "B", monthsSinceLate: null, withinTwelveMonths: false },
  ],
  publicRecords: [{ recordType: "Lawsuit", amount: "1,200" }],
  avgAccountAge: { years: 5, months: 14 },
};

test("normalize blanks placeholders and invalid scores, coerces numbers and enums", () => {
  const p = normalizeCreditReport(raw);
  assert.equal(p.name, "");
  assert.equal(p.address, "");
  assert.deepEqual(p.bureauScores, { equifax: 702, experian: 691, transunion: null });
  assert.equal(p.creditScore, 691); // lower of two valid scores
  assert.equal(p.creditCards[0].creditLimit, 10000);
  assert.equal(p.creditCards[2].accountStatus, "Current");
  assert.equal(p.publicRecords[0].recordType, "Other");
  assert.equal(p.publicRecords[0].amount, 1200);
  assert.equal(p.avgAccountAge.months, 11);
  // Date beats the contradictory flag.
  assert.equal(p.latePayments[0].withinTwelveMonths, false);
  assert.ok(p.latePayments[0].monthsSinceLate > 24);
});

test("normalize is idempotent", () => {
  const once = normalizeCreditReport(raw);
  assert.deepEqual(normalizeCreditReport(once), once);
});

test("patch: tri-bureau string, open-card utilization, consistent late counts", () => {
  const patch = buildCreditReportPatch(raw);
  assert.equal(patch.recentCreditReport, "Equifax 702 • Experian 691");
  assert.equal(patch.transunionScore, undefined);
  // (4000 + 0) / (10000 + 1000) — the charged-off card is excluded.
  assert.equal(patch.creditUtilization, 36);
  assert.equal(patch.latePaymentsCount, 2);
  assert.equal(patch.latePaymentsOlder24moCount, 1);
  assert.equal(patch.latePaymentsWithin12moCount, 0);
  assert.equal(patch.publicRecordsCount, 1);
});

test("child tables carry DB-ready rows", () => {
  const t = toChildTables(raw);
  assert.equal(t.creditCards.length, 3);
  assert.equal(t.creditCards[0].minimumPayment, 0);
  assert.equal(t.publicRecords[0].notes, "");
  assert.equal(t.chargeOffs.length, 0);
});
