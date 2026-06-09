import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CreditAnalysisView } from "@/components/CreditAnalysisView";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  FileDown,
  Pencil,
  Trash2,
  Phone,
  Mail,
  MapPin,
  Plus,
  Calendar,
  User,
  Building2,
  CreditCard as CreditCardIcon,
  FolderOpen,
  ClipboardCheck,
  AlertTriangle,
  CheckCircle2,
  TriangleAlert,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { StatusBadge } from "@/components/StatusBadge";
import { SectionCard } from "@/components/SectionCard";

import { CreditCardsSection } from "@/components/CreditCardsSection";
import { FilesSection } from "@/components/FilesSection";
import {
  autoFlags,
  autoRecommendedSteps,
  businessBankingStrength,
  businessRevenueStatus,
  fmtDate,
  fundingReadinessScore,
  overallUtilization,
  parseMissingDocs,
  personalBankingStrength,
  utilizationStatus,
} from "@/lib/calculations";
import type { ClientStatus, ClientWithDetails } from "@shared/schema";
import { generateClientPdf } from "@/lib/pdfExport";

type ProfileTab = "cpi" | "credit-analysis";

export default function ClientProfile() {
  const [, params] = useRoute("/clients/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const id = Number(params?.id);
  const [activeTab, setActiveTab] = useState<ProfileTab>("cpi");

  const { data: client, isLoading } = useQuery<ClientWithDetails>({
    queryKey: ["/api/clients", id],
    enabled: Number.isFinite(id),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/clients/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client deleted" });
      setLocation("/");
    },
    onError: (e: Error) =>
      toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !client) {
    return (
      <div className="px-6 sm:px-10 py-10 max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const missingDocs = parseMissingDocs(client.missingDocuments);
  const util = overallUtilization(client.creditCards);
  const pbs = personalBankingStrength(client);
  const bbs = businessBankingStrength(client);
  const score = fundingReadinessScore(client);
  const flags = autoFlags(client);
  const autoSteps = autoRecommendedSteps(client);
  const revStatus = businessRevenueStatus(client.monthlyRevenue);
  const utilStat = utilizationStatus(util);

  return (
    <div className="px-6 sm:px-10 py-10 max-w-5xl mx-auto pb-28">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setLocation("/")}
        className="mb-4 -ml-2 gap-1.5 text-white/70 hover:text-white hover:bg-white/10"
        data-testid="button-back"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold tracking-tight text-white" data-testid="text-client-name">
              {client.name}
            </h1>
            <StatusBadge status={client.status as ClientStatus} />
          </div>
          <div className="mt-1.5" data-testid="text-client-address">
            <InlineField
              icon={<MapPin className="h-3.5 w-3.5" />}
              value={client.address || ""}
              placeholder="Add address"
              field="address"
              clientId={id}
            />
          </div>
          <div className="flex items-center gap-4 mt-2 text-sm text-white/70 flex-wrap">
            <span data-testid="text-client-phone">
              <InlineField
                icon={<Phone className="h-3.5 w-3.5" />}
                value={client.phone || ""}
                placeholder="Add phone"
                field="phone"
                type="tel"
                clientId={id}
              />
            </span>
            <span data-testid="text-client-email">
              <InlineField
                icon={<Mail className="h-3.5 w-3.5" />}
                value={client.email || ""}
                placeholder="Add email"
                field="email"
                type="email"
                clientId={id}
              />
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              Onboarded {fmtDate(client.onboardingDate)}
            </span>
            <span className="text-xs">· Last updated {fmtDate(client.lastUpdated)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setLocation(`/clients/${id}/edit`)}
            data-testid="button-edit-client"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={async () => {
              try {
                const res = await fetch(`/api/clients/${client.id}/credit-analysis`);
                if (res.ok) {
                  const credit = await res.json();
                  generateClientPdf(client, {
                    chargeOffs: credit.chargeOffs ?? [],
                    collections: credit.collections ?? [],
                    latePayments: credit.latePayments ?? [],
                    repossessions: credit.repossessions ?? [],
                    publicRecords: credit.publicRecords ?? [],
                  });
                } else {
                  generateClientPdf(client);
                }
              } catch {
                generateClientPdf(client);
              }
            }}
            data-testid="button-export-pdf"
          >
            <FileDown className="h-4 w-4" />
            Export PDF
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="text-destructive hover:text-destructive"
                data-testid="button-delete-client"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this client?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently remove {client.name} and all associated cards and files.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteMutation.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  data-testid="button-confirm-delete"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6" data-testid="profile-tabs">
        <div className="inline-flex gap-1 p-1 rounded-lg bg-[hsl(205,80%,11%)] border border-white/5">
          <button
            type="button"
            onClick={() => setActiveTab("cpi")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === "cpi"
                ? "bg-white/10 text-white"
                : "text-white/60 hover:text-white/80"
            }`}
            data-testid="tab-cpi"
          >
            CPI
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("credit-analysis")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === "credit-analysis"
                ? "bg-white/10 text-white"
                : "text-white/60 hover:text-white/80"
            }`}
            data-testid="tab-credit-analysis"
          >
            Credit Report Analysis
          </button>
        </div>
        {activeTab === "credit-analysis" && client.creditAnalysisDate && (
          <div className="mt-3 text-xs text-white/50" data-testid="text-analyzed-date">
            Analyzed {fmtDate(client.creditAnalysisDate)}
          </div>
        )}
      </div>

      {activeTab === "credit-analysis" ? (
        <div data-testid="tab-content-credit-analysis">
          <CreditAnalysisView clientId={id} />
        </div>
      ) : (
      <div data-testid="tab-content-cpi">
      {/* Auto Flags */}
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-8" data-testid="flags-row">
          {flags.map((flag, i) => {
            const styles =
              flag.kind === "red"
                ? "bg-[hsl(0_80%_96%)] text-[hsl(0_72%_45%)] border-[hsl(0_70%_88%)]"
                : flag.kind === "amber"
                ? "bg-[hsl(38_92%_95%)] text-[hsl(30_80%_35%)] border-[hsl(38_85%_85%)]"
                : "bg-[hsl(158_65%_95%)] text-[hsl(158_65%_28%)] border-[hsl(158_50%_85%)]";
            const Icon =
              flag.kind === "green" ? CheckCircle2 : flag.kind === "red" ? AlertTriangle : TriangleAlert;
            return (
              <div
                key={i}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${styles}`}
                data-testid={`flag-${flag.kind}-${i}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {flag.text}
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-6">
        {/* Personal Info */}
        <SectionCard
          title="Personal Information"
          icon={<User className="h-5 w-5" />}
          testId="section-personal"
        >
          <div className="pt-2">
            <ReadOnlyField label="Number of Personal Bank Accounts" value={client.numBankAccounts} />
            <ReadOnlyField label="Bank Accounts" value={client.bankAccountsList} />
            <ReadOnlyField label="Age of Bank Accounts" value={client.bankAccountsAge} />
            <ReadOnlyField
              label="Recent Credit Report"
              value={(() => {
                const parts: string[] = [];
                if (client.equifaxScore != null) parts.push(`Equifax ${client.equifaxScore}`);
                if (client.experianScore != null) parts.push(`Experian ${client.experianScore}`);
                if (client.transunionScore != null) parts.push(`TransUnion ${client.transunionScore}`);
                if (parts.length > 0) return parts.join(", ");
                return client.recentCreditReport;
              })()}
            />
            <ReadOnlyBool label="Has Savings Account" value={client.hasSavings} />
            <ReadOnlyBool label="Has Retirement / 401(k)" value={client.hasRetirement401k} />
            <ReadOnlyField label="Personal Notes" value={client.personalNotes} multiline />
          </div>
        </SectionCard>

        {/* Business Info */}
        <SectionCard
          title="Business Information"
          icon={<Building2 className="h-5 w-5" />}
          testId="section-business"
        >
          <div className="pt-2">
            <ReadOnlyBool label="Active LLC" value={client.activeLLC} />
            <ReadOnlyField label="LLC Name" value={client.llcName} />
            <ReadOnlyBool label="Has Business Bank Accounts" value={client.hasBusinessAccounts} />
            <ReadOnlyField label="Business Accounts" value={client.businessAccountsList} />
            <ReadOnlyField label="Business Account Age" value={client.businessAccountsAge} />
            <ReadOnlyBool label="Generating Revenue" value={client.generatingRevenue} />
            <ReadOnlyField
              label="Monthly Revenue"
              value={client.monthlyRevenue ? `$${Number(client.monthlyRevenue).toLocaleString()}` : ""}
            />
            <ReadOnlyField
              label="Annual Revenue"
              value={client.annualRevenue ? `$${Number(client.annualRevenue).toLocaleString()}` : ""}
            />
            <ReadOnlyBool label="Has Business Credit Products" value={client.hasBusinessProducts} />
            <ReadOnlyBool label="Getting Offers in Mail" value={client.gettingOffersInMail} />
            <ReadOnlyField label="Business Credit Cards" value={client.businessCreditCards} />
            <ReadOnlyField label="Business Loans" value={client.businessLoans} />
            <ReadOnlyField label="Business Lines of Credit" value={client.businessLinesOfCredit} />
            <ReadOnlyField label="Business Notes" value={client.businessNotes} multiline />
          </div>
        </SectionCard>

        {/* Credit Utilization */}
        <SectionCard
          title="Credit Utilization"
          icon={<CreditCardIcon className="h-5 w-5" />}
          description={`Overall: ${util.toFixed(1)}% · ${utilStat}`}
          testId="section-cards"
        >
          <div className="pt-2">
            <CreditCardsSection cards={client.creditCards} />
          </div>
        </SectionCard>

        {/* Files */}
        <SectionCard
          title="Files & Documents"
          icon={<FolderOpen className="h-5 w-5" />}
          testId="section-files"
        >
          <div className="pt-2">
            <FilesSection clientId={id} files={client.files} />
          </div>
        </SectionCard>

        {/* Summary */}
        <SectionCard
          title="Overall Client Summary"
          icon={<ClipboardCheck className="h-5 w-5" />}
          testId="section-summary"
        >
          <div className="space-y-5 pt-4">
            <SummaryReadRow label="Personal Banking Strength" value={`${pbs}`} />
            <SummaryReadRow label="Business Banking Strength" value={`${bbs}`} />
            <SummaryReadRow label="Credit Utilization Status" value={utilStat} />
            <SummaryReadRow label="Business Revenue Status" value={revStatus} />
            <SummaryReadRow label="Funding Readiness Score" value={`${score}`} />

            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                Missing Documents
              </div>
              {missingDocs.length === 0 ? (
                <div className="text-sm text-muted-foreground">None — all required documents on file.</div>
              ) : (
                <ul className="space-y-1.5">
                  {missingDocs.map((doc, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm text-card-foreground"
                      data-testid={`missing-doc-${i}`}
                    >
                      <span className="text-muted-foreground mt-1">•</span>
                      <span>{doc}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                Recommended Next Steps
              </div>
              {autoSteps.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No suggestions — client looks solid.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {autoSteps.map((step, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 px-3 py-2 bg-accent/5 border border-accent/20 rounded-md text-sm text-card-foreground"
                      data-testid={`auto-step-${i}`}
                    >
                      <span className="text-accent mt-0.5">→</span>
                      <span>{step}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {client.recommendedNextSteps && (
              <ReadOnlyField
                label="Recommended Next Steps (notes)"
                value={client.recommendedNextSteps}
                multiline
              />
            )}
            {client.internalNotes && (
              <ReadOnlyField label="Internal Notes" value={client.internalNotes} multiline />
            )}
          </div>
        </SectionCard>

        <div className="text-center text-xs text-white/50 pt-4">
          Use Edit to update client info, or delete and re-upload a fresh credit report.
        </div>
      </div>
      </div>
      )}
    </div>
  );
}

function ReadOnlyField({
  label,
  value,
  multiline,
}: {
  label: string;
  value: any;
  multiline?: boolean;
}) {
  const empty = value === null || value === undefined || value === "" || value === 0;
  const display = empty ? "—" : String(value);
  return (
    <div className="space-y-1 py-3 border-b border-border/60 last:border-b-0 first:pt-0 last:pb-0">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </div>
      <div
        className={`${
          multiline ? "whitespace-pre-wrap" : ""
        } text-base ${empty ? "text-muted-foreground" : "text-card-foreground"}`}
      >
        {display}
      </div>
    </div>
  );
}

function ReadOnlyBool({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-border/60 last:border-b-0 first:pt-0 last:pb-0">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${
            value ? "bg-[hsl(120_60%_45%)]" : "bg-muted-foreground/40"
          }`}
        />
        <span className="text-sm font-medium text-card-foreground">{value ? "Yes" : "No"}</span>
      </div>
    </div>
  );
}

function SummaryReadRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-3">
      <div className="text-sm font-medium text-card-foreground">{label}</div>
      <div className="text-sm tabular-nums text-card-foreground">{value}</div>
    </div>
  );
}

function QuickStatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-card-border shadow-xl ring-1 ring-white/5 rounded-xl overflow-hidden">
      <div className="bg-card p-5 rounded-xl">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          {label}
        </div>
        <div className="text-2xl font-bold tabular-nums mt-1 text-card-foreground">{value}</div>
      </div>
    </Card>
  );
}

/**
 * Click-to-edit inline field for the client header (address / phone / email).
 * Shows a subtle "Add ..." placeholder when empty, becomes an input on click,
 * saves on Enter or blur, cancels on Escape.
 */
function InlineField({
  icon,
  value,
  placeholder,
  field,
  clientId,
  type = "text",
}: {
  icon: React.ReactNode;
  value: string;
  placeholder: string;
  field: "address" | "phone" | "email";
  clientId: number;
  type?: string;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const saveMutation = useMutation({
    mutationFn: async (next: string) =>
      apiRequest("PATCH", `/api/clients/${clientId}`, { [field]: next }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      setEditing(false);
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
      setDraft(value);
      setEditing(false);
    },
  });

  const commit = () => {
    const next = draft.trim();
    if (next === value.trim()) {
      setEditing(false);
      return;
    }
    saveMutation.mutate(next);
  };

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-white/70">{icon}</span>
        <Input
          ref={inputRef}
          type={type}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(value);
              setEditing(false);
            }
          }}
          placeholder={placeholder}
          className="h-7 px-2 py-0 text-sm bg-white/10 border-white/20 text-white placeholder:text-white/40 w-[220px]"
          data-testid={`input-inline-${field}`}
        />
      </span>
    );
  }

  const isEmpty = !value || value.trim() === "";
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={
        "inline-flex items-center gap-1.5 text-sm rounded px-1.5 py-0.5 -mx-1.5 transition-colors hover:bg-white/10 " +
        (isEmpty ? "text-white/40 hover:text-white/80" : "text-white/80 hover:text-white")
      }
      data-testid={`button-inline-edit-${field}`}
      title={isEmpty ? `Click to ${placeholder.toLowerCase()}` : "Click to edit"}
    >
      <span>{icon}</span>
      {isEmpty ? (
        <span className="inline-flex items-center gap-1">
          <Plus className="h-3 w-3" />
          {placeholder}
        </span>
      ) : (
        <span>{value}</span>
      )}
    </button>
  );
}
