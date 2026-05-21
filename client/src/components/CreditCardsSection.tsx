import {
  cardUtilization,
  fmtCurrency,
  fmtPct,
  overallUtilization,
  totalBalance,
  totalCreditLimit,
  utilizationColor,
  utilizationStatus,
} from "@/lib/calculations";
import type { CreditCard } from "@shared/schema";

export function CreditCardsSection({ cards }: { clientId?: number; cards: CreditCard[] }) {
  const overallUtil = overallUtilization(cards);
  const utilColor = utilizationColor(overallUtil);
  const utilStat = utilizationStatus(overallUtil);

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

      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium">Card Name</th>
              <th className="px-3 py-2.5 text-left font-medium">Issuer</th>
              <th className="px-3 py-2.5 text-right font-medium">Limit</th>
              <th className="px-3 py-2.5 text-right font-medium">Balance</th>
              <th className="px-3 py-2.5 text-right font-medium">Util %</th>
              <th className="px-3 py-2.5 text-right font-medium">Min Pmt</th>
              <th className="px-3 py-2.5 text-left font-medium">Due</th>
              <th className="px-3 py-2.5 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {cards.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground" data-testid="text-no-cards">
                  No credit cards on file.
                </td>
              </tr>
            )}
            {cards.map((card) => {
              const util = cardUtilization(card);
              const utilCol = utilizationColor(util);
              return (
                <tr key={card.id} className="border-t border-border" data-testid={`row-card-${card.id}`}>
                  <td className="px-3 py-3 font-medium">{card.cardName || "—"}</td>
                  <td className="px-3 py-3">{card.issuer || "—"}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmtCurrency(card.creditLimit)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmtCurrency(card.currentBalance)}</td>
                  <td
                    className="px-3 py-3 text-right font-medium tabular-nums"
                    style={{ color: utilCol }}
                    data-testid={`text-card-util-${card.id}`}
                  >
                    {util.toFixed(0)}%
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {card.minimumPayment ? fmtCurrency(card.minimumPayment) : "—"}
                  </td>
                  <td className="px-3 py-3">{card.paymentDueDate || "—"}</td>
                  <td className="px-3 py-3">{card.accountStatus}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
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
