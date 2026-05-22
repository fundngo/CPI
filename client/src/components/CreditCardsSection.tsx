import {
  bucketHex,
  bucketTintHex,
  cardUtilization,
  fmtCurrency,
  fmtPct,
  overallUtilization,
  paydownTo,
  targetBalanceAt,
  totalBalance,
  totalCreditLimit,
  utilBucket,
  utilizationColor,
  utilizationStatus,
} from "@/lib/calculations";
import type { CreditCard } from "@shared/schema";

export function CreditCardsSection({ cards }: { clientId?: number; cards: CreditCard[] }) {
  const overallUtil = overallUtilization(cards);
  const utilColor = utilizationColor(overallUtil);
  const utilStat = utilizationStatus(overallUtil);

  const totals = cards.reduce(
    (acc, c) => {
      acc.limit += c.creditLimit || 0;
      acc.balance += c.currentBalance || 0;
      acc.target30 += targetBalanceAt(c.creditLimit, 30);
      acc.target15 += targetBalanceAt(c.creditLimit, 15);
      acc.paydown30 += paydownTo(c.currentBalance, c.creditLimit, 30);
      acc.paydown15 += paydownTo(c.currentBalance, c.creditLimit, 15);
      return acc;
    },
    { limit: 0, balance: 0, target30: 0, target15: 0, paydown30: 0, paydown15: 0 }
  );

  return (
    <div className="space-y-5">
      <div className="border border-border rounded-lg overflow-hidden grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border">
        <Metric label="Total Cards" value={cards.length.toString()} testId="metric-total-cards" />
        <Metric label="Total Limit" value={fmtCurrency(totalCreditLimit(cards))} testId="metric-total-limit" />
        <Metric label="Total Balance" value={fmtCurrency(totalBalance(cards))} testId="metric-total-balance" />
        <Metric
          label="Overall Util"
          value={fmtPct(overallUtil, 1)}
          color={utilColor}
          sublabel={utilStat}
          testId="metric-overall-util"
        />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">Utilization color guide:</span>
        <LegendDot color={bucketHex("green")} label="≤ 15% · Good range" />
        <LegendDot color={bucketHex("yellow")} label="15.01–30% · Needs attention" />
        <LegendDot color={bucketHex("red")} label="> 30% · Over target" />
      </div>

      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium">Card Name</th>
              <th className="px-3 py-2.5 text-left font-medium">Issuer</th>
              <th className="px-3 py-2.5 text-right font-medium">Limit</th>
              <th className="px-3 py-2.5 text-right font-medium">Balance</th>
              <th className="px-3 py-2.5 text-right font-medium">Util %</th>
              <th className="px-3 py-2.5 text-right font-medium">Target @ 30%</th>
              <th className="px-3 py-2.5 text-right font-medium">Target @ 15%</th>
              <th className="px-3 py-2.5 text-right font-medium">Paydown to 30%</th>
              <th className="px-3 py-2.5 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {cards.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground" data-testid="text-no-cards">
                  No credit cards on file.
                </td>
              </tr>
            )}
            {cards.map((card) => {
              const util = cardUtilization(card);
              const bucket = utilBucket(util);
              const color = bucketHex(bucket);
              const tint = bucketTintHex(bucket);
              const t30 = targetBalanceAt(card.creditLimit, 30);
              const t15 = targetBalanceAt(card.creditLimit, 15);
              const p30 = paydownTo(card.currentBalance, card.creditLimit, 30);
              const p15 = paydownTo(card.currentBalance, card.creditLimit, 15);
              return (
                <tr
                  key={card.id}
                  className="border-t border-border"
                  style={{ backgroundColor: tint, borderLeft: `4px solid ${color}` }}
                  data-testid={`row-card-${card.id}`}
                >
                  <td className="px-3 py-3 font-medium text-card-foreground">{card.cardName || "—"}</td>
                  <td className="px-3 py-3 text-card-foreground">{card.issuer || "—"}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-card-foreground">{fmtCurrency(card.creditLimit)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-card-foreground">{fmtCurrency(card.currentBalance)}</td>
                  <td
                    className="px-3 py-3 text-right font-semibold tabular-nums"
                    style={{ color }}
                    data-testid={`text-card-util-${card.id}`}
                  >
                    {util.toFixed(0)}%
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-card-foreground">{fmtCurrency(t30)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-card-foreground">{fmtCurrency(t15)}</td>
                  <td className="px-3 py-3 text-right tabular-nums" data-testid={`text-card-paydown-${card.id}`}>
                    {p30 > 0 ? (
                      <>
                        <div className="font-semibold" style={{ color }}>
                          {fmtCurrency(p30)}
                        </div>
                        {p15 > p30 && (
                          <div className="text-[11px] text-muted-foreground">to 15%: {fmtCurrency(p15)}</div>
                        )}
                      </>
                    ) : (
                      <span className="text-[hsl(120_60%_38%)] font-medium">On target</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-card-foreground">{card.accountStatus}</td>
                </tr>
              );
            })}
          </tbody>
          {cards.length > 0 && (
            <tfoot className="bg-muted/30 text-card-foreground font-medium">
              <tr className="border-t-2 border-border">
                <td colSpan={2} className="px-3 py-3 text-xs uppercase tracking-wide">
                  Totals
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtCurrency(totals.limit)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtCurrency(totals.balance)}</td>
                <td className="px-3 py-3 text-right tabular-nums" style={{ color: utilColor }}>
                  {overallUtil.toFixed(1)}%
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtCurrency(totals.target30)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtCurrency(totals.target15)}</td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {totals.paydown30 > 0 ? (
                    <span className="font-semibold text-[hsl(0_72%_45%)]">
                      {fmtCurrency(totals.paydown30)}
                    </span>
                  ) : (
                    <span className="text-[hsl(120_60%_38%)]">On target</span>
                  )}
                </td>
                <td className="px-3 py-3" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function Metric({
  label,
  value,
  color,
  sublabel,
  testId,
}: {
  label: string;
  value: string;
  color?: string;
  sublabel?: string;
  testId?: string;
}) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{label}</div>
      <div className="text-lg font-semibold tabular-nums mt-1" style={color ? { color } : undefined} data-testid={testId}>
        {value}
      </div>
      {sublabel && <div className="text-xs text-muted-foreground mt-0.5">{sublabel}</div>}
    </div>
  );
}
