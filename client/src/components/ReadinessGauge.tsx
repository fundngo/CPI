import { readinessLabel } from "@/lib/calculations";

export function ReadinessGauge({ score, size = 180 }: { score: number; size?: number }) {
  const { label, color } = readinessLabel(score);
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);

  return (
    <div className="flex flex-col items-center" data-testid="readiness-gauge">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="hsl(220 15% 92%)"
            strokeWidth={stroke}
            fill="none"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 600ms ease-out, stroke 200ms" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-4xl font-semibold tabular-nums" style={{ color }} data-testid="text-readiness-score">
            {score}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">out of 100</div>
        </div>
      </div>
      <div className="mt-3 text-sm font-medium" style={{ color }} data-testid="text-readiness-label">
        {label}
      </div>
    </div>
  );
}
