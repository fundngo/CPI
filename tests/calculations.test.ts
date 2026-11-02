import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fundingReadinessScore,
  creditBlockers,
  autoFlags,
  autoRecommendedSteps,
  overallUtilization,
  utilizationStatus,
  effectiveUtilizationStatus,
  effectiveRevenueStatus,
  readinessLabel,
} from "../client/src/lib/calculations";

function card(over: Record<string, any> = {}) {
  return {
    id: 1, clientId: 1, cardName: "Card", issuer: "Bank", creditLimit: 10000, currentBalance: 500,
    paymentDueDate: "", minimumPayment: 0, accountStatus: "Current", notes: "", ...over,
  } as any;
}

// A client that maxes every readiness component.
function strongClient(over: Record<string, any> = {}) {
  return {
    numBankAccounts: 4, hasSavings: true, hasRetirement401k: true,
    activeLLC: true, hasBusinessAccounts: true, generatingRevenue: true, hasBusinessProducts: true,
    gettingOffersInMail: true, monthlyRevenue: 60000, missingDocuments: "[]",
    equifaxScore: 760, experianScore: 750, transunionScore: 755,
    chargeOffsCount: 0, collectionsCount: 0, repossessionsCount: 0, publicRecordsCount: 0,
    latePaymentsWithin12moCount: 0,
    fundingReadinessScoreOverride: null, personalBankingStrengthOverride: null,
    businessBankingStrengthOverride: null, creditUtilizationStatusOverride: null,
    businessRevenueStatusOverride: null, lastUpdated: new Date().toISOString(),
    creditCards: [card()],
    ...over,
  } as any;
}

test("strong client with clean credit is Funding Ready", () => {
  const c = strongClient();
  assert.equal(fundingReadinessScore(c), 100);
  assert.equal(readinessLabel(100).label, "Funding Ready");
  assert.equal(creditBlockers(c).length, 0);
});

test("low mid-score caps readiness at 79 with a red flag and a step", () => {
  const c = strongClient({ equifaxScore: 540, experianScore: 560, transunionScore: 700 });
  assert.equal(fundingReadinessScore(c), 79);
  assert.equal(readinessLabel(79).label, "Almost Ready");
  assert.ok(autoFlags(c).some((f) => f.kind === "red" && f.text.includes("560")));
  assert.ok(autoRecommendedSteps(c).some((s) => s.includes("680")));
  assert.ok(!autoRecommendedSteps(c).some((s) => s.includes("funding ready")));
});

test("each derogatory type blocks Funding Ready", () => {
  for (const key of ["chargeOffsCount", "collectionsCount", "repossessionsCount", "publicRecordsCount", "latePaymentsWithin12moCount"]) {
    assert.equal(fundingReadinessScore(strongClient({ [key]: 1 })), 79, key);
  }
});

test("cap never raises a lower score, and the override still wins", () => {
  const weak = strongClient({ numBankAccounts: 0, hasSavings: false, hasRetirement401k: false, chargeOffsCount: 2 });
  assert.ok(fundingReadinessScore(weak) < 79);
  assert.equal(fundingReadinessScore(strongClient({ chargeOffsCount: 3, fundingReadinessScoreOverride: 90 })), 90);
});

test("no scores on file does not cap, but raises an amber flag", () => {
  const c = strongClient({ equifaxScore: null, experianScore: null, transunionScore: null });
  assert.equal(fundingReadinessScore(c), 100);
  assert.ok(autoFlags(c).some((f) => f.kind === "amber" && f.text.includes("No credit scores")));
});

test("utilization ignores closed and charged-off cards", () => {
  const cards = [
    card({ creditLimit: 10000, currentBalance: 2000 }),
    card({ creditLimit: 5000, currentBalance: 5000, accountStatus: "Charged Off" }),
    card({ creditLimit: 5000, currentBalance: 0, accountStatus: "Closed" }),
  ];
  assert.equal(overallUtilization(cards), 20);
});

test("exactly 30% is Good and gets no amber utilization flag", () => {
  assert.equal(utilizationStatus(30), "Good");
  assert.equal(utilizationStatus(30.5), "Caution");
  const c = strongClient({ creditCards: [card({ creditLimit: 10000, currentBalance: 3000 })] });
  assert.ok(!autoFlags(c).some((f) => f.text.includes("utilization")));
});

test("status overrides are honored", () => {
  assert.equal(effectiveUtilizationStatus({ creditUtilizationStatusOverride: "Critical" } as any, 5), "Critical");
  assert.equal(effectiveUtilizationStatus({ creditUtilizationStatusOverride: null } as any, 5), "Excellent");
  assert.equal(effectiveRevenueStatus({ businessRevenueStatusOverride: "Strong", monthlyRevenue: 0 } as any), "Strong");
  assert.equal(effectiveRevenueStatus({ businessRevenueStatusOverride: "bogus", monthlyRevenue: 6000 } as any), "Growing");
});
