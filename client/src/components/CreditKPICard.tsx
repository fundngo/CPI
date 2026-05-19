import type { LucideIcon } from "lucide-react";

interface CreditKPICardProps {
  label: string;
  value: string | number;
  subStat?: string;
  icon: LucideIcon;
  tint?: "negative" | "neutral";
  testId?: string;
}

export function CreditKPICard({
  label,
  value,
  subStat,
  icon: Icon,
  tint = "neutral",
  testId,
}: CreditKPICardProps) {
  const isNegative = tint === "negative";
  const containerClass = isNegative
    ? "bg-red-50 border-red-200"
    : "bg-card border-card-border";
  const iconColor = isNegative ? "text-red-600" : "text-emerald-600";
  const valueColor = isNegative ? "text-red-700" : "text-card-foreground";

  return (
    <div
      className={`rounded-xl border p-5 shadow-xl ring-1 ring-white/5 ${containerClass}`}
      data-testid={testId}
    >
      <div className="flex items-start justify-between mb-3">
        <span
          className={`text-[11px] uppercase tracking-wider font-medium ${
            isNegative ? "text-red-700/80" : "text-muted-foreground"
          }`}
        >
          {label}
        </span>
        <Icon className={`h-4 w-4 ${iconColor}`} />
      </div>
      <div
        className={`text-3xl font-bold leading-tight ${valueColor}`}
        data-testid={`${testId}-value`}
      >
        {value}
      </div>
      {subStat && (
        <div
          className={`text-xs mt-1.5 ${
            isNegative ? "text-red-700/70" : "text-muted-foreground"
          }`}
        >
          {subStat}
        </div>
      )}
    </div>
  );
}
