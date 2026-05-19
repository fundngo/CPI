import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ClientStatus } from "@shared/schema";

const styles: Record<ClientStatus, string> = {
  "New": "bg-sky-50 text-sky-800 border border-sky-200",
  "In Progress": "bg-amber-50 text-amber-800 border border-amber-200",
  "Funding Ready": "bg-green-100 text-green-800 border border-green-300",
  "Approved": "bg-green-500 text-white border border-green-600",
  "Paused": "bg-slate-100 text-slate-700 border border-slate-200",
};

export function StatusBadge({ status, className }: { status: ClientStatus; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("font-medium text-xs px-2.5 py-0.5", styles[status], className)}
      data-testid={`status-${status.replace(/\s+/g, "-").toLowerCase()}`}
    >
      {status}
    </Badge>
  );
}
