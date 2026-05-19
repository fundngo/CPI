import { strengthLabel } from "@/lib/calculations";

export function StrengthMeter({ label, score, testId }: { label: string; score: number; testId?: string }) {
  const tier = strengthLabel(score);
  const color =
    tier === "Strong" ? "hsl(120 60% 45%)" : tier === "Fair" ? "hsl(38 92% 50%)" : "hsl(0 72% 51%)";
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums" style={{ color }}>
          {score} <span className="text-xs text-muted-foreground font-normal">· {tier}</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
