import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, AlertTriangle, FileText, Banknote, CheckCircle2, Eye, EyeOff } from "lucide-react";

type Diff = {
  key: string;
  label: string;
  section: string;
  format: "number" | "text" | "bool" | "money" | "percent";
  currentValue: any;
  proposedValue: any;
  changed: boolean;
};

type Account = {
  creditor?: string;
  accountType?: string;
  status?: string;
  openedYear?: number | null;
  balance?: number | null;
};

type PreviewData = {
  errors: string[];
  creditReport?: {
    fileName: string;
    diffs: Diff[];
    allAccounts: Account[];
    parsed: any;
  } | null;
  bankStatement?: {
    fileName: string;
    accountHolderName: string | null;
    bankName: string | null;
    isBusinessAccount: boolean;
    businessClassificationReason: string | null;
    accountsFound: number;
    accounts: any[];
    diffs: Diff[];
    parsed: any;
  } | null;
};

function formatValue(v: any, format: Diff["format"]): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean" || format === "bool") return v ? "Yes" : "No";
  if (format === "percent") return `${v}%`;
  if (format === "money" && typeof v === "number") return `$${v.toLocaleString()}`;
  return String(v);
}

export function UpdateReviewModal({
  open,
  onOpenChange,
  clientId,
  preview,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: number;
  preview: PreviewData | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [accountsExpanded, setAccountsExpanded] = useState(false);
  const [showUnchanged, setShowUnchanged] = useState(false);

  // Auto-tick rows that actually changed
  useEffect(() => {
    if (!preview) return;
    const next: Record<string, boolean> = {};
    const all = [
      ...(preview.creditReport?.diffs || []),
      ...(preview.bankStatement?.diffs || []),
    ];
    for (const d of all) next[d.key] = d.changed;
    setSelected(next);
    setAccountsExpanded(false);
    setShowUnchanged(false);
  }, [preview]);

  // Robust equality — normalize whitespace, treat null/undefined/"" as equal,
  // and compare numbers numerically so 16 vs "16" doesn't count as a change.
  function valuesEqual(a: any, b: any): boolean {
    const norm = (v: any) => {
      if (v == null) return "";
      if (typeof v === "number") return String(v);
      return String(v).trim().replace(/\s+/g, " ");
    };
    const na = norm(a);
    const nb = norm(b);
    if (na === nb) return true;
    const fa = parseFloat(na);
    const fb = parseFloat(nb);
    if (!Number.isNaN(fa) && !Number.isNaN(fb) && fa === fb) return true;
    return false;
  }

  // Recompute `changed` defensively so visually-identical rows are treated as unchanged
  function isActuallyChanged(d: Diff): boolean {
    return d.changed && !valuesEqual(d.currentValue, d.proposedValue);
  }

  function visibleDiffs(diffs: Diff[]): Diff[] {
    if (showUnchanged) return diffs;
    return diffs.filter(isActuallyChanged);
  }

  const applyMutation = useMutation({
    mutationFn: async () => {
      const acceptedKeys = Object.entries(selected)
        .filter(([, v]) => v)
        .map(([k]) => k);
      const body = {
        acceptedKeys,
        creditReportParsed: preview?.creditReport?.parsed,
        bankStatementParsed: preview?.bankStatement?.parsed,
      };
      const res = await apiRequest("POST", `/api/clients/${clientId}/apply-from-files`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId] });
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/credit-analysis`] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Profile updated", description: "Selected changes have been applied." });
      onOpenChange(false);
    },
    onError: (e: any) => {
      toast({ title: "Apply failed", description: e?.message || "Try again", variant: "destructive" });
    },
  });

  const cr = preview?.creditReport;
  const bs = preview?.bankStatement;

  const changedCount = useMemo(() => {
    const all = [...(cr?.diffs || []), ...(bs?.diffs || [])];
    return all.filter(isActuallyChanged).length;
  }, [cr, bs]);

  const unchangedCount = useMemo(() => {
    const all = [...(cr?.diffs || []), ...(bs?.diffs || [])];
    return all.length - all.filter(isActuallyChanged).length;
  }, [cr, bs]);

  const selectedCount = useMemo(
    () => Object.values(selected).filter(Boolean).length,
    [selected]
  );

  function toggleAllInSection(diffs: Diff[], val: boolean) {
    setSelected((prev) => {
      const next = { ...prev };
      for (const d of diffs) next[d.key] = val;
      return next;
    });
  }

  function renderDiffRow(d: Diff) {
    const checked = !!selected[d.key];
    return (
      <label
        key={d.key}
        className={`flex items-start gap-3 p-3 rounded-md border ${
          d.changed
            ? "bg-amber-500/5 border-amber-500/30"
            : "bg-muted/30 border-border"
        } hover:bg-muted/50 cursor-pointer transition-colors`}
      >
        <Checkbox
          checked={checked}
          onCheckedChange={(v) =>
            setSelected((prev) => ({ ...prev, [d.key]: !!v }))
          }
          className="mt-0.5"
          data-testid={`checkbox-diff-${d.key}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium">{d.label}</span>
            {d.changed && (
              <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-600 dark:text-amber-400">
                changed
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="text-muted-foreground">
              <span className="block text-[10px] uppercase tracking-wide opacity-60 mb-0.5">
                Current
              </span>
              <span className="font-mono">{formatValue(d.currentValue, d.format)}</span>
            </div>
            <div className={d.changed ? "text-foreground font-medium" : "text-muted-foreground"}>
              <span className="block text-[10px] uppercase tracking-wide opacity-60 mb-0.5">
                Proposed
              </span>
              <span className="font-mono">{formatValue(d.proposedValue, d.format)}</span>
            </div>
          </div>
        </div>
      </label>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[90vh] max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4 border-b shrink-0">
          <DialogTitle>Review extracted data</DialogTitle>
          <DialogDescription>
            {changedCount > 0
              ? `${changedCount} field${changedCount === 1 ? "" : "s"} would change. Tick the ones you want to apply.`
              : "Nothing different was found. You can still re-apply any field if you want."}
          </DialogDescription>
          {unchangedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowUnchanged((s) => !s)}
              className="mt-2 inline-flex items-center gap-1.5 self-start text-xs text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-toggle-unchanged"
            >
              {showUnchanged ? (
                <>
                  <EyeOff className="h-3.5 w-3.5" /> Hide {unchangedCount} unchanged field{unchangedCount === 1 ? "" : "s"}
                </>
              ) : (
                <>
                  <Eye className="h-3.5 w-3.5" /> Show {unchangedCount} unchanged field{unchangedCount === 1 ? "" : "s"}
                </>
              )}
            </button>
          )}
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-6 space-y-6">
            {preview?.errors && preview.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <ul className="list-disc list-inside text-sm">
                    {preview.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {cr && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Credit Report</h3>
                    <span className="text-xs text-muted-foreground truncate max-w-[300px]">
                      {cr.fileName}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => toggleAllInSection(cr.diffs, true)}
                    >
                      Select all
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => toggleAllInSection(cr.diffs, false)}
                    >
                      Clear
                    </Button>
                  </div>
                </div>

                {cr.allAccounts && cr.allAccounts.length > 0 && (
                  <Collapsible open={accountsExpanded} onOpenChange={setAccountsExpanded}>
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-xs font-medium hover:bg-muted transition-colors"
                      >
                        <span>
                          Accounts Found: <strong>{cr.allAccounts.length}</strong> tradelines
                        </span>
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition-transform ${
                            accountsExpanded ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2">
                      <div className="rounded-md border bg-muted/20 max-h-60 overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                            <tr className="text-left">
                              <th className="px-2 py-1.5 font-medium">#</th>
                              <th className="px-2 py-1.5 font-medium">Creditor</th>
                              <th className="px-2 py-1.5 font-medium">Type</th>
                              <th className="px-2 py-1.5 font-medium">Status</th>
                              <th className="px-2 py-1.5 font-medium text-right">Year</th>
                              <th className="px-2 py-1.5 font-medium text-right">Balance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cr.allAccounts.map((a, i) => (
                              <tr key={i} className="border-t border-border/50">
                                <td className="px-2 py-1.5 text-muted-foreground">{i + 1}</td>
                                <td className="px-2 py-1.5 font-medium truncate max-w-[160px]">
                                  {a.creditor || "—"}
                                </td>
                                <td className="px-2 py-1.5 text-muted-foreground">{a.accountType || "—"}</td>
                                <td className="px-2 py-1.5 text-muted-foreground">{a.status || "—"}</td>
                                <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                                  {a.openedYear || "—"}
                                </td>
                                <td className="px-2 py-1.5 text-right font-mono">
                                  {a.balance != null ? `$${a.balance.toLocaleString()}` : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}

                <div className="space-y-2">
                  {visibleDiffs(cr.diffs).length === 0 ? (
                    <div className="text-center py-6 text-xs text-muted-foreground rounded-md border border-dashed border-border">
                      No credit-report fields changed.
                    </div>
                  ) : (
                    visibleDiffs(cr.diffs).map(renderDiffRow)
                  )}
                </div>
              </section>
            )}

            {bs && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Banknote className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Bank Statement</h3>
                    <span className="text-xs text-muted-foreground truncate max-w-[300px]">
                      {bs.fileName}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => toggleAllInSection(bs.diffs, true)}
                    >
                      Select all
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => toggleAllInSection(bs.diffs, false)}
                    >
                      Clear
                    </Button>
                  </div>
                </div>

                <div className="rounded-md border bg-muted/20 p-3 text-xs space-y-1">
                  <div>
                    <span className="text-muted-foreground">Bank:</span>{" "}
                    <span className="font-medium">{bs.bankName || "—"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Account holder:</span>{" "}
                    <span className="font-medium">{bs.accountHolderName || "—"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Classified as:</span>{" "}
                    <Badge variant={bs.isBusinessAccount ? "default" : "secondary"} className="text-xs">
                      {bs.isBusinessAccount ? "Business" : "Personal"}
                    </Badge>
                    {bs.businessClassificationReason && (
                      <span className="text-muted-foreground italic ml-1">
                        — {bs.businessClassificationReason}
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Accounts found:</span>{" "}
                    <span className="font-medium">{bs.accountsFound}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  {visibleDiffs(bs.diffs).length === 0 ? (
                    <div className="text-center py-6 text-xs text-muted-foreground rounded-md border border-dashed border-border">
                      No bank-statement fields changed.
                    </div>
                  ) : (
                    visibleDiffs(bs.diffs).map(renderDiffRow)
                  )}
                </div>
              </section>
            )}

            {!cr && !bs && (
              <div className="text-center py-12 text-sm text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                Nothing to review.
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="p-4 border-t bg-muted/20 flex flex-row items-center justify-between sm:justify-between gap-3 shrink-0">
          <span className="text-xs text-muted-foreground">
            {selectedCount} of {changedCount + (showUnchanged ? unchangedCount : 0)} selected
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => applyMutation.mutate()}
              disabled={selectedCount === 0 || applyMutation.isPending}
              data-testid="button-apply-selected"
            >
              {applyMutation.isPending ? "Applying…" : `Apply ${selectedCount} change${selectedCount === 1 ? "" : "s"}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
