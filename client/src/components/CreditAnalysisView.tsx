import { useQuery } from "@tanstack/react-query";
import {
  TrendingDown,
  AlertTriangle,
  Clock,
  Calendar,
  FileX,
  Car,
  Gavel,
} from "lucide-react";
import { CreditKPICard } from "./CreditKPICard";
import { CreditTable, type CreditTableColumn } from "./CreditTable";
import type {
  Client,
  ChargeOff,
  Collection,
  LatePayment,
  Repossession,
  PublicRecord,
} from "@shared/schema";

interface CreditAnalysisResponse {
  client: Client;
  chargeOffs: ChargeOff[];
  collections: Collection[];
  latePayments: LatePayment[];
  repossessions: Repossession[];
  publicRecords: PublicRecord[];
}

function fmtMoney(v: number): string {
  if (v == null || isNaN(v)) return "—";
  return `$${Number(v).toLocaleString()}`;
}

function SectionHeading({
  title,
  count,
  testId,
}: {
  title: string;
  count: number;
  testId?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 mb-3" data-testid={testId}>
      <h2 className="text-white font-semibold text-base">{title}</h2>
      <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-2 rounded-full bg-red-500/20 text-red-200 text-xs font-medium">
        {count}
      </span>
    </div>
  );
}

export function CreditAnalysisView({ clientId }: { clientId: number }) {
  const { data, isLoading } = useQuery<CreditAnalysisResponse>({
    queryKey: ["/api/clients", clientId, "credit-analysis"],
    enabled: Number.isFinite(clientId),
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-32 rounded-xl bg-card/70 border border-card-border animate-pulse"
            />
          ))}
        </div>
        <div className="h-32 rounded-xl bg-card/70 border border-card-border animate-pulse" />
      </div>
    );
  }

  const {
    client,
    chargeOffs,
    collections,
    latePayments,
    repossessions,
    publicRecords,
  } = data;

  // 3-bucket split for late payments
  const within12 = latePayments.filter((lp) => lp.withinTwelveMonths);
  const between12And24 = latePayments.filter(
    (lp) => !lp.withinTwelveMonths && lp.monthsSinceLate > 0 && lp.monthsSinceLate <= 24
  );
  const older = latePayments.filter(
    (lp) => !lp.withinTwelveMonths && lp.monthsSinceLate > 24
  );
  // Catch any late payments not flagged within12 but with no monthsSinceLate set
  const uncategorized = latePayments.filter(
    (lp) => !lp.withinTwelveMonths && lp.monthsSinceLate === 0
  );
  const olderCombined = [...older, ...uncategorized];

  const hasAny =
    chargeOffs.length > 0 ||
    collections.length > 0 ||
    latePayments.length > 0 ||
    repossessions.length > 0 ||
    publicRecords.length > 0 ||
    client.totalAccountsCount > 0;

  if (!hasAny) {
    return (
      <div
        className="rounded-xl border border-card-border bg-card shadow-xl ring-1 ring-white/5 p-12 flex flex-col items-center text-center"
        data-testid="credit-analysis-empty"
      >
        <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-4">
          <FileX className="h-7 w-7 text-muted-foreground" />
        </div>
        <div className="text-card-foreground font-medium text-base mb-1">
          No credit analysis data available
        </div>
        <div className="text-muted-foreground text-sm max-w-sm">
          Upload a credit report at intake to populate this view.
        </div>
      </div>
    );
  }

  const ageValue =
    client.avgAccountAgeMonths > 0
      ? `${client.avgAccountAgeYears} years ${client.avgAccountAgeMonths} months`
      : `${client.avgAccountAgeYears} years`;

  const chargeOffCols: CreditTableColumn<ChargeOff>[] = [
    { key: "creditor", header: "CREDITOR", render: (r) => r.creditor },
    { key: "type", header: "TYPE", render: (r) => r.accountType },
    {
      key: "original",
      header: "ORIGINAL AMOUNT",
      render: (r) => fmtMoney(r.originalAmount),
    },
    { key: "balance", header: "BALANCE", render: (r) => fmtMoney(r.balance) },
    { key: "opened", header: "OPENED", render: (r) => r.openedDate || "—" },
    { key: "closed", header: "CLOSED", render: (r) => r.closedDate || "—" },
  ];

  const collectionCols: CreditTableColumn<Collection>[] = [
    { key: "creditor", header: "CREDITOR", render: (r) => r.creditor },
    {
      key: "original",
      header: "ORIGINAL CREDITOR",
      render: (r) => r.originalCreditor,
    },
    { key: "balance", header: "BALANCE", render: (r) => fmtMoney(r.balance) },
    { key: "reported", header: "REPORTED", render: (r) => r.reportedDate || "—" },
  ];

  const lateCols: CreditTableColumn<LatePayment>[] = [
    { key: "creditor", header: "CREDITOR", render: (r) => r.creditor },
    { key: "type", header: "TYPE", render: (r) => r.accountType },
    { key: "status", header: "STATUS", render: (r) => r.status },
    {
      key: "recent",
      header: "MOST RECENT LATE",
      render: (r) => r.mostRecentLateDate || "—",
    },
    {
      key: "history",
      header: "LATE HISTORY",
      render: (r) => r.lateHistory || "—",
    },
  ];

  const repoCols: CreditTableColumn<Repossession>[] = [
    { key: "creditor", header: "CREDITOR", render: (r) => r.creditor },
    { key: "type", header: "TYPE", render: (r) => r.accountType || "—" },
    {
      key: "original",
      header: "ORIGINAL AMOUNT",
      render: (r) => fmtMoney(r.originalAmount),
    },
    { key: "balance", header: "BALANCE", render: (r) => fmtMoney(r.balance) },
    { key: "opened", header: "OPENED", render: (r) => r.openedDate || "—" },
    { key: "repo", header: "REPO DATE", render: (r) => r.repoDate || "—" },
  ];

  const publicRecordCols: CreditTableColumn<PublicRecord>[] = [
    { key: "type", header: "TYPE", render: (r) => r.recordType },
    {
      key: "court",
      header: "COURT / AGENCY",
      render: (r) => r.courtOrAgency || "—",
    },
    {
      key: "ref",
      header: "REFERENCE #",
      render: (r) => r.referenceNumber || "—",
    },
    {
      key: "amount",
      header: "AMOUNT",
      render: (r) => (r.amount > 0 ? fmtMoney(r.amount) : "—"),
    },
    { key: "status", header: "STATUS", render: (r) => r.status || "—" },
    { key: "filed", header: "FILED", render: (r) => r.filedDate || "—" },
  ];

  return (
    <div className="space-y-6" data-testid="credit-analysis-view">
      {/* KPI summary — table-style grid matching the credit reports tables */}
      <div
        className="rounded-xl border border-card-border bg-card shadow-xl ring-1 ring-white/5 overflow-hidden"
        data-testid="credit-kpi-grid"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60">
                <th className="px-5 py-3 text-left text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                  Metric
                </th>
                <th className="px-5 py-3 text-right text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                  Count
                </th>
                <th className="px-5 py-3 text-left text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                  Detail
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  key: "charge-offs",
                  label: "Charge-Offs",
                  icon: TrendingDown,
                  value: client.chargeOffsCount,
                  detail: client.chargeOffsCount > 0 ? "Active negative items" : "None on file",
                  negative: client.chargeOffsCount > 0,
                },
                {
                  key: "collections",
                  label: "Collections",
                  icon: AlertTriangle,
                  value: client.collectionsCount,
                  detail: client.collectionsCount > 0 ? "Accounts in collection" : "None on file",
                  negative: client.collectionsCount > 0,
                },
                {
                  key: "late-payments",
                  label: "Late Payments",
                  icon: Clock,
                  value: client.latePaymentsCount,
                  detail:
                    client.latePaymentsCount > 0
                      ? `${client.latePaymentsWithin12moCount} within 12mo · ${client.latePayments12to24moCount} (12–24mo) · ${client.latePaymentsOlder24moCount} (>24mo)`
                      : "No late payments",
                  negative: client.latePaymentsCount > 0,
                },
                {
                  key: "repossessions",
                  label: "Repossessions",
                  icon: Car,
                  value: client.repossessionsCount,
                  detail: client.repossessionsCount > 0 ? "Vehicle or asset repos" : "None on file",
                  negative: client.repossessionsCount > 0,
                },
                {
                  key: "public-records",
                  label: "Public Records",
                  icon: Gavel,
                  value: client.publicRecordsCount,
                  detail:
                    client.publicRecordsCount > 0
                      ? "Bankruptcies, judgments, liens"
                      : "None on file",
                  negative: client.publicRecordsCount > 0,
                },
                {
                  key: "avg-age",
                  label: "Avg Account Age",
                  icon: Calendar,
                  value: ageValue,
                  detail: `${client.totalAccountsCount} accounts found`,
                  negative: false,
                },
              ].map((row, i, arr) => {
                const Icon = row.icon;
                return (
                  <tr
                    key={row.key}
                    className={i !== arr.length - 1 ? "border-b border-border/60" : ""}
                    data-testid={`kpi-row-${row.key}`}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <Icon
                          className={`h-4 w-4 ${row.negative ? "text-destructive" : "text-accent"}`}
                        />
                        <span className="font-medium text-card-foreground">{row.label}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span
                        className={`font-semibold text-base ${
                          row.negative ? "text-destructive" : "text-card-foreground"
                        }`}
                      >
                        {row.value}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground text-xs">{row.detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Credit Age Overview */}
      <div
        className="rounded-xl border border-card-border bg-card shadow-xl ring-1 ring-white/5 p-6"
        data-testid="credit-age-overview"
      >
        <h2 className="text-card-foreground font-semibold text-base mb-4">
          Credit Age Overview
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
              Oldest Account
            </div>
            <div className="text-card-foreground font-semibold" data-testid="text-oldest-account">
              {client.oldestAccountCreditor || "—"}
              {client.oldestAccountYear ? ` (${client.oldestAccountYear})` : ""}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
              Newest Account
            </div>
            <div className="text-card-foreground font-semibold" data-testid="text-newest-account">
              {client.newestAccountCreditor || "—"}
              {client.newestAccountYear ? ` (${client.newestAccountYear})` : ""}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
              Accounts Found
            </div>
            <div className="text-card-foreground font-semibold" data-testid="text-total-accounts">
              {client.totalAccountsCount}
            </div>
          </div>
        </div>
      </div>

      {/* Repossessions */}
      {repossessions.length > 0 && (
        <div data-testid="section-repossessions">
          <SectionHeading title="Repossessions" count={repossessions.length} />
          <CreditTable
            columns={repoCols}
            rows={repossessions}
            testId="table-repossessions"
          />
        </div>
      )}

      {/* Charge-Off Accounts */}
      {chargeOffs.length > 0 && (
        <div data-testid="section-charge-offs">
          <SectionHeading
            title="Charge-Off Accounts"
            count={chargeOffs.length}
          />
          <CreditTable
            columns={chargeOffCols}
            rows={chargeOffs}
            testId="table-charge-offs"
          />
        </div>
      )}

      {/* Collections */}
      {collections.length > 0 && (
        <div data-testid="section-collections">
          <SectionHeading title="Collections" count={collections.length} />
          <CreditTable
            columns={collectionCols}
            rows={collections}
            testId="table-collections"
          />
        </div>
      )}

      {/* Late Payments — Within 12 Months */}
      {within12.length > 0 && (
        <div data-testid="section-late-within-12">
          <SectionHeading
            title="Late Payments — Within 12 Months"
            count={within12.length}
          />
          <CreditTable
            columns={lateCols}
            rows={within12}
            testId="table-late-within-12"
          />
        </div>
      )}

      {/* Late Payments — 12 to 24 Months */}
      {between12And24.length > 0 && (
        <div data-testid="section-late-12-to-24">
          <SectionHeading
            title="Late Payments — 12 to 24 Months"
            count={between12And24.length}
          />
          <CreditTable
            columns={lateCols}
            rows={between12And24}
            testId="table-late-12-to-24"
          />
        </div>
      )}

      {/* Late Payments — Over 24 Months */}
      {olderCombined.length > 0 && (
        <div data-testid="section-late-older-24">
          <SectionHeading
            title="Late Payments — Over 24 Months"
            count={olderCombined.length}
          />
          <CreditTable
            columns={lateCols}
            rows={olderCombined}
            testId="table-late-older-24"
          />
        </div>
      )}

      {/* Public Records */}
      {publicRecords.length > 0 && (
        <div data-testid="section-public-records">
          <SectionHeading
            title="Public Records"
            count={publicRecords.length}
          />
          <CreditTable
            columns={publicRecordCols}
            rows={publicRecords}
            testId="table-public-records"
          />
        </div>
      )}
    </div>
  );
}
