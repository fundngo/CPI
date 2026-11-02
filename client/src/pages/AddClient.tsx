import { useState, useCallback, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CARD_STATUSES, type CardStatus, type Client } from "@shared/schema";
import { formatBureauScores, normalizeAge, splitLatePayments, validScore } from "@shared/credit";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, UploadCloud, Loader2, FileText, AlertCircle, CheckCircle2, Plus, X } from "lucide-react";

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
  phone: string;
  email: string;
  creditScore: number | null;
  creditScoreSource: string | null;
  bureauScores: { equifax: number | null; experian: number | null; transunion: number | null };
  creditCards: ExtractedCard[];
  chargeOffs: ExtractedChargeOff[];
  collections: ExtractedCollection[];
  latePayments: ExtractedLatePayment[];
  repossessions: ExtractedRepossession[];
  publicRecords: ExtractedPublicRecord[];
  totalAccountsCount?: number;
  oldestAccount?: { creditor: string; year: number } | null;
  newestAccount?: { creditor: string; year: number } | null;
  avgAccountAge?: { years: number; months: number } | null;
}

function toDraft(raw: any): ExtractedData {
  const arr = (v: any) => (Array.isArray(v) ? v : []);
  const b = raw?.bureauScores || {};
  return {
    name: String(raw?.name || ""),
    address: String(raw?.address || ""),
    phone: String(raw?.phone || ""),
    email: String(raw?.email || ""),
    creditScore: validScore(raw?.creditScore),
    creditScoreSource: raw?.creditScoreSource || null,
    bureauScores: { equifax: validScore(b.equifax), experian: validScore(b.experian), transunion: validScore(b.transunion) },
    creditCards: arr(raw?.creditCards).map((c: any) => ({
      cardName: String(c?.cardName || ""),
      issuer: String(c?.issuer || ""),
      creditLimit: Number(c?.creditLimit) || 0,
      currentBalance: Number(c?.currentBalance) || 0,
      minimumPayment: c?.minimumPayment != null ? Number(c.minimumPayment) || 0 : null,
      paymentDueDate: c?.paymentDueDate || null,
      accountStatus: (CARD_STATUSES as readonly string[]).includes(c?.accountStatus) ? c.accountStatus : "Current",
    })),
    chargeOffs: arr(raw?.chargeOffs),
    collections: arr(raw?.collections),
    latePayments: arr(raw?.latePayments),
    repossessions: arr(raw?.repossessions),
    publicRecords: arr(raw?.publicRecords),
    totalAccountsCount: Number(raw?.totalAccountsCount) || 0,
    oldestAccount: raw?.oldestAccount || null,
    newestAccount: raw?.newestAccount || null,
    avgAccountAge: raw?.avgAccountAge || null,
  };
}

// apiRequest errors look like "500: {\"message\":\"...\"}" — show just the message.
function cleanError(msg: string): string {
  const m = msg.match(/^\d{3}:\s*([\s\S]*)$/);
  const body = m ? m[1] : msg;
  try {
    const j = JSON.parse(body);
    if (j?.message) return String(j.message);
  } catch {}
  return body;
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
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (stage !== "extracting") return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [stage]);

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
        setExtracted(toDraft(json.extracted));
        setStage("review");
      } catch (e: any) {
        setErrorMsg(cleanError(e?.message || "Extraction failed"));
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
      if (!extracted.name.trim()) throw new Error("Enter the client's name before creating.");
      const b = extracted.bureauScores;
      const today = new Date().toISOString().slice(0, 10);
      const late = splitLatePayments(extracted.latePayments);
      const age = normalizeAge(extracted.avgAccountAge?.years, extracted.avgAccountAge?.months);
      const tri = formatBureauScores(b);
      const cleaned = pdfBase64.includes(",") ? pdfBase64.split(",")[1] : pdfBase64;

      const payload = {
        name: extracted.name.trim(),
        address: extracted.address.trim(),
        phone: (extracted.phone || "").trim(),
        email: (extracted.email || "").trim(),
        onboardingDate: today,
        status: "New" as const,
        recentCreditReport:
          tri || (extracted.creditScore != null ? `${extracted.creditScore}${extracted.creditScoreSource ? ` (${extracted.creditScoreSource})` : ""}` : ""),
        equifaxScore: b.equifax,
        experianScore: b.experian,
        transunionScore: b.transunion,
        creditAnalysisDate: today,
        chargeOffsCount: extracted.chargeOffs.length,
        collectionsCount: extracted.collections.length,
        latePaymentsCount: extracted.latePayments.length,
        latePaymentsWithin12moCount: late.within12.length,
        latePayments12to24moCount: late["12to24"].length,
        latePaymentsOlder24moCount: late.over24.length,
        repossessionsCount: extracted.repossessions.length,
        publicRecordsCount: extracted.publicRecords.length,
        totalAccountsCount: Math.max(0, Math.round(Number(extracted.totalAccountsCount) || 0)),
        avgAccountAgeYears: age.years,
        avgAccountAgeMonths: age.months,
        oldestAccountCreditor: extracted.oldestAccount?.creditor || "",
        oldestAccountYear: Math.round(Number(extracted.oldestAccount?.year) || 0),
        newestAccountCreditor: extracted.newestAccount?.creditor || "",
        newestAccountYear: Math.round(Number(extracted.newestAccount?.year) || 0),
        creditCards: extracted.creditCards,
        chargeOffs: extracted.chargeOffs,
        collections: extracted.collections,
        latePayments: extracted.latePayments,
        repossessions: extracted.repossessions,
        publicRecords: extracted.publicRecords,
        file: pdfBase64
          ? {
              fileName: fileName || "credit-report.pdf",
              fileType: "credit_report" as const,
              fileSize: Math.floor((cleaned.length * 3) / 4),
              base64Content: cleaned,
            }
          : undefined,
      };
      return (await (await apiRequest("POST", "/api/clients", payload)).json()) as Client;
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
            <div className="text-xs text-muted-foreground max-w-sm" data-testid="text-extract-progress">
              {elapsed < 20
                ? "Reading the credit report and finding personal details, scores, and accounts. This usually takes 10–30 seconds."
                : elapsed < 45
                ? "Still working — larger reports take longer."
                : "This looks like a scanned or encoded-font PDF, so we're reading the pages as images. This can take up to 2 minutes."}
              <div className="mt-2 tabular-nums">{elapsed}s</div>
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
              <div className="text-sm text-card-foreground mt-2 max-w-md" data-testid="text-extract-error">
                {errorMsg || "Try a different PDF or enter the client manually."}
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
          onChange={setExtracted}
          fileName={fileName}
          onBack={() => setStage("upload")}
          onCreate={() => createMutation.mutate()}
          isCreating={createMutation.isPending}
        />
      )}
    </div>
  );
}

type DerogKey = "chargeOffs" | "collections" | "latePayments" | "repossessions" | "publicRecords";

const DEROG_SECTIONS: Array<{ key: DerogKey; label: string; describe: (r: any) => string }> = [
  { key: "chargeOffs", label: "Charge-Offs", describe: (r) => `${r.creditor || "—"} · ${r.accountType || "—"} · bal $${Number(r.balance || 0).toLocaleString()}` },
  { key: "collections", label: "Collections", describe: (r) => `${r.creditor || "—"}${r.originalCreditor ? ` (orig. ${r.originalCreditor})` : ""} · bal $${Number(r.balance || 0).toLocaleString()}` },
  { key: "latePayments", label: "Late Payments", describe: (r) => `${r.creditor || "—"} · ${r.lateHistory || "—"} · last ${r.mostRecentLateDate || "—"}` },
  { key: "repossessions", label: "Repossessions", describe: (r) => `${r.creditor || "—"} · ${r.accountType || "—"} · repo ${r.repoDate || "—"}` },
  { key: "publicRecords", label: "Public Records", describe: (r) => `${r.recordType || "Other"} · ${r.courtOrAgency || "—"} · filed ${r.filedDate || "—"}` },
];

function ReviewExtracted({
  data,
  onChange,
  fileName,
  onBack,
  onCreate,
  isCreating,
}: {
  data: ExtractedData;
  onChange: (d: ExtractedData) => void;
  fileName: string;
  onBack: () => void;
  onCreate: () => void;
  isCreating: boolean;
}) {
  const set = <K extends keyof ExtractedData>(k: K, v: ExtractedData[K]) => onChange({ ...data, [k]: v });
  const setScore = (bureau: "equifax" | "experian" | "transunion", raw: string) => {
    const v = raw.trim() === "" ? null : Number(raw);
    onChange({ ...data, bureauScores: { ...data.bureauScores, [bureau]: v } });
  };
  const scoreInvalid = (v: number | null) => v != null && (v < 300 || v > 850 || !Number.isInteger(v));
  const anyScoreInvalid = (["equifax", "experian", "transunion"] as const).some((k) => scoreInvalid(data.bureauScores[k]));

  const updateCard = (i: number, patch: Partial<ExtractedCard>) =>
    set("creditCards", data.creditCards.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const removeCard = (i: number) => set("creditCards", data.creditCards.filter((_, idx) => idx !== i));
  const addCard = () =>
    set("creditCards", [
      ...data.creditCards,
      { cardName: "", issuer: "", creditLimit: 0, currentBalance: 0, minimumPayment: null, paymentDueDate: null, accountStatus: "Current" },
    ]);
  const removeDerog = (key: DerogKey, i: number) =>
    onChange({ ...data, [key]: (data[key] as any[]).filter((_, idx) => idx !== i) });

  const late = splitLatePayments(data.latePayments);
  const nameMissing = !data.name.trim();

  return (
    <div className="space-y-5">
      <Card className="p-8 border-card-border shadow-xl ring-1 ring-white/5 rounded-xl">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
            <CheckCircle2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-xl font-bold text-card-foreground">Review extracted data</div>
            <div className="text-sm text-muted-foreground">
              Check and correct anything below before creating the client. Blank means the report didn't show it.
            </div>
          </div>
        </div>
        <div className="text-xs text-muted-foreground mt-4 mb-6 flex items-center gap-2" data-testid="text-review-filename">
          <FileText className="h-3.5 w-3.5" />
          {fileName}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <EditField label="Name (required)" className="md:col-span-2">
            <Input
              value={data.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Client's full name"
              className={nameMissing ? "border-destructive" : ""}
              data-testid="input-extract-name"
            />
          </EditField>
          <EditField label="Address" className="md:col-span-2">
            <Input
              value={data.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="STREET, CITY ST ZIP"
              data-testid="input-extract-address"
            />
          </EditField>
          <EditField label="Phone">
            <Input value={data.phone} onChange={(e) => set("phone", e.target.value)} data-testid="input-extract-phone" />
          </EditField>
          <EditField label="Email">
            <Input value={data.email} onChange={(e) => set("email", e.target.value)} data-testid="input-extract-email" />
          </EditField>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-5">
          {(["equifax", "experian", "transunion"] as const).map((k) => (
            <EditField key={k} label={k === "transunion" ? "TransUnion" : k[0].toUpperCase() + k.slice(1)}>
              <Input
                type="number"
                inputMode="numeric"
                min={300}
                max={850}
                value={data.bureauScores[k] ?? ""}
                onChange={(e) => setScore(k, e.target.value)}
                placeholder="—"
                className={scoreInvalid(data.bureauScores[k]) ? "border-destructive" : ""}
                data-testid={`input-extract-${k}`}
              />
            </EditField>
          ))}
        </div>
        {anyScoreInvalid && (
          <div className="text-xs text-destructive mt-2" data-testid="text-score-error">
            Scores must be whole numbers from 300 to 850 (or blank).
          </div>
        )}
      </Card>

      <Card className="p-8 border-card-border shadow-xl ring-1 ring-white/5 rounded-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-bold uppercase tracking-wide text-card-foreground">
            Credit Cards ({data.creditCards.length})
          </div>
          <Button variant="outline" size="sm" onClick={addCard} className="gap-1.5" data-testid="button-extract-add-card">
            <Plus className="h-3.5 w-3.5" /> Add card
          </Button>
        </div>
        {data.creditCards.length === 0 ? (
          <div className="text-sm text-muted-foreground">No credit cards found.</div>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left font-semibold">Card</th>
                  <th className="px-2 py-2 text-left font-semibold">Issuer</th>
                  <th className="px-2 py-2 text-right font-semibold">Limit</th>
                  <th className="px-2 py-2 text-right font-semibold">Balance</th>
                  <th className="px-2 py-2 text-left font-semibold">Status</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="text-card-foreground">
                {data.creditCards.map((c, i) => (
                  <tr key={i} className="border-t border-border" data-testid={`extract-card-${i}`}>
                    <td className="px-2 py-1.5">
                      <Input className="h-8" value={c.cardName} onChange={(e) => updateCard(i, { cardName: e.target.value })} data-testid={`input-extract-card-name-${i}`} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="h-8" value={c.issuer} onChange={(e) => updateCard(i, { issuer: e.target.value })} data-testid={`input-extract-card-issuer-${i}`} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="h-8 text-right w-24 ml-auto" type="number" min={0} value={c.creditLimit} onChange={(e) => updateCard(i, { creditLimit: Number(e.target.value) || 0 })} data-testid={`input-extract-card-limit-${i}`} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="h-8 text-right w-24 ml-auto" type="number" min={0} value={c.currentBalance} onChange={(e) => updateCard(i, { currentBalance: Number(e.target.value) || 0 })} data-testid={`input-extract-card-balance-${i}`} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Select value={c.accountStatus} onValueChange={(v) => updateCard(i, { accountStatus: v as CardStatus })}>
                        <SelectTrigger className="h-8 w-32" data-testid={`select-extract-card-status-${i}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CARD_STATUSES.map((st) => (
                            <SelectItem key={st} value={st}>{st}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeCard(i)} data-testid={`button-extract-remove-card-${i}`}>
                        <X className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-8 border-card-border shadow-xl ring-1 ring-white/5 rounded-xl">
        <div className="text-sm font-bold uppercase tracking-wide text-card-foreground mb-1">Credit Analysis</div>
        <div className="text-xs text-muted-foreground mb-4">
          Remove any item that doesn't belong — the counts update to match.
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <ExtractStat label="Charge-Offs" value={data.chargeOffs.length} />
          <ExtractStat label="Collections" value={data.collections.length} />
          <ExtractStat
            label="Late Payments"
            value={data.latePayments.length}
            sub={data.latePayments.length > 0 ? `${late.within12.length} within 12mo` : undefined}
          />
          <ExtractStat label="Repossessions" value={data.repossessions.length} />
          <ExtractStat label="Public Records" value={data.publicRecords.length} />
          <ExtractStat
            label="Accounts Found"
            value={Number(data.totalAccountsCount) || 0}
            sub={
              data.avgAccountAge && (data.avgAccountAge.years || data.avgAccountAge.months)
                ? `avg age ${normalizeAge(data.avgAccountAge.years, data.avgAccountAge.months).years}y ${normalizeAge(data.avgAccountAge.years, data.avgAccountAge.months).months}m`
                : undefined
            }
          />
        </div>

        {DEROG_SECTIONS.some((sec) => (data[sec.key] as any[]).length > 0) && (
          <div className="mt-6 space-y-4">
            {DEROG_SECTIONS.filter((sec) => (data[sec.key] as any[]).length > 0).map((sec) => (
              <div key={sec.key} data-testid={`extract-derog-${sec.key}`}>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">{sec.label}</div>
                <ul className="space-y-1">
                  {(data[sec.key] as any[]).map((row, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 text-sm text-card-foreground border border-border rounded-md px-3 py-1.5">
                      <span className="truncate">{sec.describe(row)}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive shrink-0"
                        onClick={() => removeDerog(sec.key, i)}
                        data-testid={`button-remove-${sec.key}-${i}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
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
        <div className="flex items-center gap-3">
          {nameMissing && <span className="text-sm text-white/70">Enter a name to continue</span>}
          <Button
            onClick={onCreate}
            disabled={isCreating || nameMissing || anyScoreInvalid}
            className="px-8 h-11 rounded-lg font-semibold"
            data-testid="button-create-client"
          >
            {isCreating ? "Creating…" : "Create Client"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function EditField({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className || ""}`}>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      {children}
    </div>
  );
}

function ExtractStat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div
      className="rounded-lg border border-card-border bg-muted/40 p-4"
      style={value > 0 && label !== "Accounts Found" ? { boxShadow: "inset 3px 0 0 hsl(0 72% 55%)" } : undefined}
      data-testid={`extract-stat-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
    >
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className="text-2xl font-bold tabular-nums mt-1 text-card-foreground">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}
