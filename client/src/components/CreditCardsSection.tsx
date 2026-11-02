import {
  bucketHex,
  bucketTintHex,
  cardUtilization,
  fmtCurrency,
  fmtPct,
  isActiveCard,
  overallUtilization,
  paydownSummary,
  targetBalanceAt,
  utilBucket,
  utilizationColor,
  utilizationStatus,
} from "@/lib/calculations";
import type { CreditCard } from "@shared/schema";

// Light column tints for the two target columns (30% = amber, 15% = green).
const COL30_BG = "#fdf3dc";
const COL15_BG = "#e6f6e6";
const COL30_TEXT = "#b7791f";
const COL15_TEXT = "#2f8f2f";

export function CreditCardsSection({ cards }: { clientId?: number; cards: CreditCard[] }) {
  const overallUtil = overallUtilization(cards);
  const utilColor = utilizationColor(overallUtil);
  const utilStat = utilizationStatus(overallUtil);
  const summary = paydownSummary(cards);
  const activeCards = cards.filter(isActiveCard);
  const totals30 = activeCards.reduce((s, c) => s + targetBalanceAt(c.creditLimit, 30), 0);
  const totals15 = activeCards.reduce((s, c) => s + targetBalanceAt(c.creditLimit, 15), 0);

  return (
    <div className="space-y-5">
      <div className="border border-border rounded-lg overflow-hidden grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border">
        <Metric label="Open Cards" value={activeCards.length.toString()} testId="metric-total-cards" />
        <Metric label="Total Limit" value={fmtCurrency(summary.limit)} testId="metric-total-limit" />
        <Metric label="Total Balance" value={fmtCurrency(summary.balance)} testId="metric-total-balance" />
        <Metric
          label="Overall Util"
          value={fmtPct(overallUtil, 1)}
          color={utilColor}
          sublabel={utilStat}
          testId="metric-overall-util"
        />
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <LegendDot color={bucketHex("green")} label="15% or less · Good" />
        <LegendDot color={bucketHex("yellow")} label="15–30% · Watch" />
        <LegendDot color={bucketHex("red")} label="Over 30% · Over target" />
      </div>

      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm" data-testid="table-cards">
          <thead className="bg-muted text-muted-foreground text-xs uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2.5 text-left font-semibold">Card</th>
              <th className="px-3 py-2.5 text-left font-semibold">Issuer</th>
              <th className="px-3 py-2.5 text-right font-semibold">Limit</th>
              <th className="px-3 py-2.5 text-right font-semibold">Balance</th>
              <th className="px-3 py-2.5 text-right font-semibold">Util</th>
              <th className="px-3 py-2.5 text-right font-semibold" style={{ backgroundColor: COL30_BG, color: COL30_TEXT }}>
                30% Balance
              </th>
              <th className="px-3 py-2.5 text-right font-semibold" style={{ backgroundColor: COL15_BG, color: COL15_TEXT }}>
                15% Balance
              </th>
            </tr>
          </thead>
          <tbody>
            {cards.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground" data-testid="text-no-cards">
                  No credit cards on file.
                </td>
              </tr>
            )}
            {cards.map((card) => {
              const active = isActiveCard(card);
              const util = cardUtilization(card);
              const bucket = utilBucket(util);
              const color = active ? bucketHex(bucket) : "#94a3b8";
              const tint = active ? bucketTintHex(bucket) : "#f8fafc";
              return (
                <tr
                  key={card.id}
                  className={`border-t border-border ${active ? "" : "opacity-60"}`}
                  style={{ backgroundColor: tint, boxShadow: `inset 4px 0 0 ${color}` }}
                  data-testid={`row-card-${card.id}`}
                >
                  <td className="pl-4 pr-3 py-3 font-medium text-card-foreground">
                    {card.cardName || "—"}
                    {!active && (
                      <span className="ml-2 text-[11px] font-normal text-muted-foreground" data-testid={`text-card-status-${card.id}`}>
                        ({card.accountStatus} · not counted)
                      </span>
                    )}
                    {active && card.accountStatus === "Past Due" && (
                      <span className="ml-2 text-[11px] font-semibold text-[hsl(0_72%_45%)]">Past Due</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-card-foreground">{card.issuer || "—"}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-card-foreground">{fmtCurrency(card.creditLimit)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-card-foreground">{fmtCurrency(card.currentBalance)}</td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums" style={{ color }} data-testid={`text-card-util-${card.id}`}>
                    {util.toFixed(0)}%
                  </td>
                  <td
                    className="px-3 py-3 text-right tabular-nums font-semibold"
                    style={{ backgroundColor: COL30_BG, color: COL30_TEXT }}
                    data-testid={`text-card-t30-${card.id}`}
                  >
                    {fmtCurrency(targetBalanceAt(card.creditLimit, 30))}
                  </td>
                  <td
                    className="px-3 py-3 text-right tabular-nums font-semibold"
                    style={{ backgroundColor: COL15_BG, color: COL15_TEXT }}
                    data-testid={`text-card-t15-${card.id}`}
                  >
                    {fmtCurrency(targetBalanceAt(card.creditLimit, 15))}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {cards.length > 0 && (
            <tfoot className="bg-muted text-card-foreground font-semibold">
              <tr className="border-t-2 border-border">
                <td colSpan={2} className="pl-4 pr-3 py-3 text-xs uppercase tracking-wide">
                  Totals (open cards)
                </td>
                <td className="px-3 py-3 text-right tabular-nums" data-testid="text-total-limit">{fmtCurrency(summary.limit)}</td>
                <td className="px-3 py-3 text-right tabular-nums" data-testid="text-total-balance">{fmtCurrency(summary.balance)}</td>
                <td className="px-3 py-3 text-right tabular-nums" style={{ color: utilColor }} data-testid="text-total-util">
                  {overallUtil.toFixed(1)}%
                </td>
                <td className="px-3 py-3 text-right tabular-nums" style={{ backgroundColor: COL30_BG, color: COL30_TEXT }} data-testid="text-total-t30">
                  {fmtCurrency(totals30)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums" style={{ backgroundColor: COL15_BG, color: COL15_TEXT }} data-testid="text-total-t15">
                  {fmtCurrency(totals15)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {summary.limit > 0 && (
        <div className="rounded-lg border border-border bg-muted p-4" data-testid="paydown-summary">
          <div className="text-xs font-bold uppercase tracking-wide text-card-foreground mb-2">
            Paydown to hit target utilization
          </div>
          <PaydownLine pct={30} paydown={summary.paydown30} balanceAfter={summary.target30} color={COL30_TEXT} />
          <PaydownLine pct={15} paydown={summary.paydown15} balanceAfter={summary.target15} color={COL15_TEXT} />
        </div>
      )}
    </div>
  );
}

function PaydownLine({ pct, paydown, balanceAfter, color }: { pct: number; paydown: number; balanceAfter: number; color: string }) {
  return (
    <div className="text-sm text-card-foreground py-0.5" data-testid={`text-paydown-${pct}`}>
      To reach {pct}% utilization:{" "}
      {paydown > 0 ? (
        <>
          pay down{" "}
          <span className="font-bold tabular-nums" style={{ color }}>
            {fmtCurrency(paydown)}
          </span>{" "}
          <span className="text-muted-foreground">(balance drops to {fmtCurrency(balanceAfter)})</span>
        </>
      ) : (
        <span className="font-semibold" style={{ color }}>
          already there
        </span>
      )}
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
