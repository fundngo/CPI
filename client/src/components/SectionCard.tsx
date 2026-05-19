import { ReactNode } from "react";
import { Card } from "@/components/ui/card";

export function SectionCard({
  title,
  icon,
  description,
  children,
  testId,
  rightSlot,
}: {
  title: string;
  icon?: ReactNode;
  description?: string;
  children: ReactNode;
  /** Kept for backwards compat — sections are always expanded now */
  defaultOpen?: boolean;
  testId?: string;
  rightSlot?: ReactNode;
}) {
  return (
    <Card
      className="border border-card-border shadow-lg rounded-xl bg-card p-6 sm:p-8"
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-start gap-3 min-w-0">
          {icon && (
            <div className="text-emerald-600 shrink-0 mt-0.5" aria-hidden>
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-card-foreground tracking-tight">
              {title}
            </h2>
            {description && (
              <p className="text-sm text-muted-foreground mt-1">
                {description}
              </p>
            )}
          </div>
        </div>
        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
      </div>
      <div>{children}</div>
    </Card>
  );
}
