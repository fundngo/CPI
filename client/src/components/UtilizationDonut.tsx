import { utilizationColor } from "@/lib/calculations";

export function UtilizationDonut({ pct, size = 180 }: { pct: number; size?: number }) {
  const color = utilizationColor(pct);
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, pct));
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className="flex flex-col items-center" data-testid="utilization-donut">
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
          <div className="text-4xl font-semibold tabular-nums" style={{ color }} data-testid="text-util-pct">
            {pct.toFixed(0)}%
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">utilization</div>
        </div>
      </div>
    </div>
  );
}
