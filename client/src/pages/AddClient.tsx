import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Client } from "@shared/schema";
import { ArrowLeft, UploadCloud, Loader2, FileText, AlertCircle, CheckCircle2 } from "lucide-react";

interface ExtractedCard {
  cardName: string;
  issuer: string;
  creditLimit: number;
  currentBalance: number;
  minimumPayment: number | null;
  paymentDueDate: string | null;
  accountStatus: "Current" | "Past Due" | "Closed" | "Charged Off";
}

interface ExtractedChargeOff {
  creditor: string;
  accountType: string;
  originalAmount: number;
  balance: number;
  openedDate: string;
  closedDate: string;
}

interface ExtractedCollection {
  creditor: string;
  originalCreditor: string;
  balance: number;
  reportedDate: string;
}

interface ExtractedLatePayment {
  creditor: string;
  accountType: string;
  status: "Open" | "Closed";
  mostRecentLateDate: string;
  lateHistory: string;
  withinTwelveMonths: boolean;
  monthsSinceLate?: number;
}

interface ExtractedRepossession {
  creditor: string;
  accountType: string;
  originalAmount: number;
  balance: number;
  openedDate: string;
  repoDate: string;
  status: string;
}

interface ExtractedPublicRecord {
  recordType: "Bankruptcy" | "Judgment" | "Foreclosure" | "Tax Lien" | "Other";
  courtOrAgency: string;
  referenceNumber: string;
  amount: number;
  status: string;
  filedDate: string;
}

interface ExtractedData {
  name: string;
  address: string;
  phone: string | null;
  email: string | null;
  creditScore: number | null;
  creditScoreSource: string | null;
  creditCards: ExtractedCard[];
  chargeOffs?: ExtractedChargeOff[];
  collections?: ExtractedCollection[];
  latePayments?: ExtractedLatePayment[];
  repossessions?: ExtractedRepossession[];
  publicRecords?: ExtractedPublicRecord[];
  totalAccountsCount?: number;
  oldestAccount?: { creditor: string; year: number } | null;
  newestAccount?: { creditor: string; year: number } | null;
  avgAccountAge?: { years: number; months: number } | null;
}

type Stage = "upload" | "extracting" | "review" | "error" | "creating";

export default function AddClient() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [stage, setStage] = useState<Stage>("upload");
  const [extracted, setExtracted] = useState<ExtractedData | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const onDrop = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        toast({ title: "PDF only", description: "Please upload a .pdf file.", variant: "destructive" });
        return;
      }
      setFileName(file.name);
      setStage("extracting");
      setErrorMsg("");
      try {
        const dataUrl = await fileToBase64(file);
        setPdfBase64(dataUrl);
        const res = await apiRequest("POST", "/api/extract-credit-report", {
          fileBase64: dataUrl,
          fileName: file.name,
        });
        const json = await res.json();
        if (!json?.extracted) {
          throw new Error("No data returned");
        }
        setExtracted(json.extracted as ExtractedData);
        setStage("review");
      } catch (e: any) {
        setErrorMsg(e?.message || "Extraction failed");
        setStage("error");
      }
    },
    [toast]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    multiple: false,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!extracted) throw new Error("Nothing to create");
      // Build a credit report summary string
      const reportSummary =
        extracted.creditScore != null
          ? `${extracted.creditScore}${extracted.creditScoreSource ? ` (${extracted.creditScoreSource})` : ""}`
          : "";

      // Compose initial notes with address
      const personalNotes = extracted.address ? `Address: ${extracted.address}` : "";

      const today = new Date().toISOString().slice(0, 10);
      const chargeOffsList = extracted.chargeOffs || [];
      const collectionsList = extracted.collections || [];
      const latePaymentsList = extracted.latePayments || [];
      const repossessionsList = extracted.repossessions || [];
      const publicRecordsList = extracted.publicRecords || [];
      const within12 = latePaymentsList.filter((l) => l.withinTwelveMonths).length;
      const between12And24 = latePaymentsList.filter(
        (l) => !l.withinTwelveMonths && (Number(l.monthsSinceLate) || 0) > 0 && (Number(l.monthsSinceLate) || 0) <= 24
      ).length;
      const older = latePaymentsList.filter(
        (l) => !l.withinTwelveMonths && (Number(l.monthsSinceLate) || 0) > 24
      ).length;

      const clientPayload: any = {
        name: extracted.name || "Unnamed Client",
        phone: extracted.phone || "",
        email: extracted.email || "",
        onboardingDate: today,
        status: "New" as const,
        recentCreditReport: reportSummary,
        personalNotes,
        creditAnalysisDate: today,
        chargeOffsCount: chargeOffsList.length,
        collectionsCount: collectionsList.length,
        latePaymentsCount: latePaymentsList.length,
        latePaymentsWithin12moCount: within12,
        latePayments12to24moCount: between12And24,
        latePaymentsOlder24moCount: older,
        repossessionsCount: repossessionsList.length,
        publicRecordsCount: publicRecordsList.length,
        totalAccountsCount: Number(extracted.totalAccountsCount) || 0,
        avgAccountAgeYears: Number(extracted.avgAccountAge?.years) || 0,
        avgAccountAgeMonths: Number(extracted.avgAccountAge?.months) || 0,
        oldestAccountCreditor: extracted.oldestAccount?.creditor || "",
        oldestAccountYear: Number(extracted.oldestAccount?.year) || 0,
        newestAccountCreditor: extracted.newestAccount?.creditor || "",
        newestAccountYear: Number(extracted.newestAccount?.year) || 0,
        chargeOffs: chargeOffsList,
        collections: collectionsList,
        latePayments: latePaymentsList,
        repossessions: repossessionsList,
        publicRecords: publicRecordsList,
      };

      const created = (await (await apiRequest("POST", "/api/clients", clientPayload)).json()) as Client;

      // Add cards
      for (const card of extracted.creditCards || []) {
        await apiRequest("POST", `/api/clients/${created.id}/cards`, {
          cardName: card.cardName || "Card",
          issuer: card.issuer || "",
          creditLimit: Number(card.creditLimit) || 0,
          currentBalance: Number(card.currentBalance) || 0,
          minimumPayment: card.minimumPayment != null ? Number(card.minimumPayment) : 0,
          paymentDueDate: card.paymentDueDate || "",
          accountStatus: card.accountStatus || "Current",
          notes: "",
        });
      }

      // Attach PDF as file
      if (pdfBase64) {
        const cleaned = pdfBase64.includes(",") ? pdfBase64.split(",")[1] : pdfBase64;
        await apiRequest("POST", `/api/clients/${created.id}/files`, {
          fileName: fileName || "credit-report.pdf",
          fileType: "credit_report",
          fileSize: Math.floor((cleaned.length * 3) / 4),
          base64Content: pdfBase64,
        });
      }

      return created;
    },
    onSuccess: (client) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client created", description: `${client.name} is now in your dashboard.` });
      setLocation(`/clients/${client.id}`);
    },
    onError: (e: Error) => {
      toast({ title: "Couldn't create client", description: e.message, variant: "destructive" });
      setStage("review");
    },
  });

  return (
    <div className="px-10 py-10 max-w-3xl mx-auto">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setLocation("/")}
        className="mb-4 -ml-2 gap-1.5 text-white/70 hover:text-white hover:bg-white/10"
        data-testid="button-back-dashboard"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Button>

      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-white" data-testid="text-add-client-title">
          New Client
        </h1>
        <p className="text-base text-white/70 mt-2">
          Drop a credit report PDF and we'll extract the client's name, address, credit score, and accounts.
        </p>
      </header>

      {stage === "upload" && (
        <>
          <Card className="border-card-border shadow-xl ring-1 ring-white/5 rounded-xl overflow-hidden">
            <div
              {...getRootProps()}
              className={`p-12 cursor-pointer transition-colors ${
                isDragActive ? "bg-primary/10" : "bg-card hover:bg-muted/30"
              }`}
              data-testid="dropzone-upload"
            >
              <input {...getInputProps()} data-testid="input-file" />
              <div className="flex flex-col items-center text-center gap-4">
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <UploadCloud className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <div className="text-xl font-semibold text-card-foreground">
                    Upload Credit Report to Auto-Fill Client Info
                  </div>
                  <div className="text-sm text-muted-foreground mt-2 max-w-md">
                    Drop a credit report PDF here, or click to choose a file. We'll extract the client's
                    name, address, credit score, and accounts automatically.
                  </div>
                </div>
                <Button variant="outline" className="mt-2" data-testid="button-choose-file">
                  Choose PDF
                </Button>
                <div className="text-xs text-muted-foreground">PDF only · up to 50 MB</div>
              </div>
            </div>
          </Card>
          <div className="text-center mt-5 text-sm text-white/70">
            Or{" "}
            <Link
              href="/clients/new/manual"
              className="text-primary hover:text-primary/80 underline-offset-4 hover:underline"
              data-testid="link-manual"
            >
              enter manually
            </Link>
            .
          </div>
        </>
      )}

      {stage === "extracting" && (
        <Card className="p-12 border-card-border shadow-xl ring-1 ring-white/5 rounded-xl">
          <div className="flex flex-col items-center text-center gap-4">
            <Loader2 className="h-10 w-10 text-primary animate-spin" />
            <div className="text-lg font-semibold text-card-foreground">Extracting client data…</div>
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {fileName}
            </div>
            <div className="text-xs text-muted-foreground max-w-sm">
              Reading the credit report and identifying personal details and account information.
              This usually takes 10–30 seconds.
            </div>
          </div>
        </Card>
      )}

      {stage === "error" && (
        <Card className="p-10 border-card-border shadow-xl ring-1 ring-white/5 rounded-xl">
          <div className="flex flex-col items-center text-center gap-4">
            <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="h-7 w-7 text-destructive" />
            </div>
            <div>
              <div className="text-lg font-semibold text-card-foreground">
                Could not extract data from this file
              </div>
              <div className="text-sm text-muted-foreground mt-2 max-w-md">
                Try a different PDF or enter manually. {errorMsg && <span className="block mt-1 text-xs">{errorMsg}</span>}
              </div>
            </div>
            <div className="flex gap-3 mt-2">
              <Button variant="outline" onClick={() => setStage("upload")} data-testid="button-try-again">
                Try Another PDF
              </Button>
              <Button onClick={() => setLocation("/clients/new/manual")} data-testid="button-go-manual">
                Enter Manually
              </Button>
            </div>
          </div>
        </Card>
      )}

      {stage === "review" && extracted && (
        <ReviewExtracted
          data={extracted}
          fileName={fileName}
          onBack={() => setStage("upload")}
          onCreate={() => createMutation.mutate()}
          isCreating={createMutation.isPending}
        />
      )}
    </div>
  );
}

function ReviewExtracted({
  data,
  fileName,
  onBack,
  onCreate,
  isCreating,
}: {
  data: ExtractedData;
  fileName: string;
  onBack: () => void;
  onCreate: () => void;
  isCreating: boolean;
}) {
  const dash = (v: any) => (v === null || v === undefined || v === "" ? "—" : String(v));
  const fmtMoney = (v: number) =>
    v === 0 || v == null ? "—" : `$${Number(v).toLocaleString()}`;

  return (
    <div className="space-y-5">
      <Card className="p-8 border-card-border shadow-xl ring-1 ring-white/5 rounded-xl">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
            <CheckCircle2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-xl font-semibold text-card-foreground">Review extracted data</div>
            <div className="text-sm text-muted-foreground">
              Confirm what we found before creating the client.
            </div>
          </div>
        </div>
        <div className="text-xs text-muted-foreground mt-4 mb-6 flex items-center gap-2">
          <FileText className="h-3.5 w-3.5" />
          {fileName}
        </div>

        <div className="space-y-4">
          <ReadField label="Name" value={dash(data.name)} testId="extract-name" />
          <ReadField label="Address" value={dash(data.address)} testId="extract-address" />
          <ReadField label="Phone" value={dash(data.phone)} testId="extract-phone" />
          <ReadField label="Email" value={dash(data.email)} testId="extract-email" />
          <ReadField
            label="Credit Score"
            value={
              data.creditScore != null
                ? `${data.creditScore}${data.creditScoreSource ? ` (${data.creditScoreSource})` : ""}`
                : "—"
            }
            testId="extract-credit-score"
          />
        </div>
      </Card>

      <Card className="p-8 border-card-border shadow-xl ring-1 ring-white/5 rounded-xl">
        <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
          Credit Analysis
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <ExtractStat label="Charge-Offs" value={(data.chargeOffs || []).length} />
          <ExtractStat label="Collections" value={(data.collections || []).length} />
          <ExtractStat
            label="Late Payments"
            value={(data.latePayments || []).length}
            sub={
              (data.latePayments || []).length > 0
                ? `${(data.latePayments || []).filter((l) => l.withinTwelveMonths).length} within 12mo`
                : undefined
            }
          />
          <ExtractStat label="Repossessions" value={(data.repossessions || []).length} />
          <ExtractStat label="Public Records" value={(data.publicRecords || []).length} />
          <ExtractStat
            label="Total Accounts"
            value={Number(data.totalAccountsCount) || (data.creditCards || []).length}
            sub={
              data.avgAccountAge
                ? `avg ${data.avgAccountAge.years}y ${data.avgAccountAge.months}m`
                : undefined
            }
          />
        </div>
      </Card>

      <Card className="p-8 border-card-border shadow-xl ring-1 ring-white/5 rounded-xl">
        <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
          Credit Cards ({(data.creditCards || []).length})
        </div>
        {(data.creditCards || []).length === 0 ? (
          <div className="text-sm text-muted-foreground">No credit cards found.</div>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left font-medium">Card</th>
                  <th className="px-2 py-2 text-left font-medium">Issuer</th>
                  <th className="px-2 py-2 text-right font-medium">Limit</th>
                  <th className="px-2 py-2 text-right font-medium">Balance</th>
                  <th className="px-2 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="text-card-foreground">
                {data.creditCards.map((c, i) => (
                  <tr key={i} className="border-t border-border" data-testid={`extract-card-${i}`}>
                    <td className="px-2 py-2.5">{dash(c.cardName)}</td>
                    <td className="px-2 py-2.5">{dash(c.issuer)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{fmtMoney(c.creditLimit)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{fmtMoney(c.currentBalance)}</td>
                    <td className="px-2 py-2.5">{dash(c.accountStatus)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="flex items-center justify-between gap-3 pt-2">
        <Button
          variant="ghost"
          onClick={onBack}
          className="text-white/70 hover:text-white hover:bg-white/10 gap-2"
          data-testid="button-back-upload"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          onClick={onCreate}
          disabled={isCreating}
          className="px-8 h-11 rounded-lg font-medium"
          data-testid="button-create-client"
        >
          {isCreating ? "Creating…" : "Create Client"}
        </Button>
      </div>
    </div>
  );
}

function ExtractStat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div
      className="rounded-lg border border-card-border bg-muted/30 p-4"
      data-testid={`extract-stat-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
    >
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums mt-1 text-card-foreground">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function ReadField({ label, value, testId }: { label: string; value: string; testId?: string }) {
  const isEmpty = value === "—";
  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div
        className={`text-base ${isEmpty ? "text-muted-foreground" : "text-card-foreground"}`}
        data-testid={testId}
      >
        {value}
      </div>
    </div>
  );
}
