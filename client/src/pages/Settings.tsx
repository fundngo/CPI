import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Settings as SettingsIcon, CheckCircle2, XCircle } from "lucide-react";

type AppInfo = {
  aiConfigured: boolean;
  model: string;
  visionAvailable: boolean;
  persistentStorage: boolean;
  environment: string;
};

export default function Settings() {
  const { data: info, isLoading } = useQuery<AppInfo>({ queryKey: ["/api/app-info"] });

  return (
    <div className="px-6 sm:px-10 py-10 max-w-5xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3" data-testid="text-settings-title">
          <SettingsIcon className="h-7 w-7" />
          Settings
        </h1>
        <p className="text-base text-white/70 mt-2">About this app and how it's set up.</p>
      </header>

      <Card className="p-8 border-card-border shadow-lg rounded-xl">
        <h2 className="text-xl font-bold text-card-foreground mb-3">About CPI</h2>
        <div className="space-y-3 text-sm text-card-foreground leading-relaxed">
          <p>
            CPI (Client Profile Intake) keeps each client's banking, business, and credit picture in one record for
            Fund &amp; Go / Get You Right Consulting.
          </p>
          <p>
            Upload a credit report and CPI reads it with AI, builds the profile, scores funding readiness, and exports a
            2-page PDF that shows exactly how much to pay down on each card to reach 30% and 15% utilization.
          </p>
          <p>
            AI results are never saved without review. If something on a report isn't clear, CPI leaves the field blank
            instead of guessing.
          </p>
        </div>
      </Card>

      <Card className="p-8 border-card-border shadow-lg rounded-xl mt-6">
        <h2 className="text-xl font-bold text-card-foreground mb-4">App Information</h2>
        {isLoading || !info ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <StatusRow
              label="AI extraction"
              ok={info.aiConfigured}
              okText="Configured"
              badText="Not configured — set ANTHROPIC_API_KEY"
              testId="info-ai"
            />
            <Row label="AI model" value={info.model} testId="info-model" />
            <StatusRow
              label="Scanned / encoded PDF support"
              ok={info.visionAvailable}
              okText="Available (pdftoppm)"
              badText="Unavailable — install poppler-utils"
              testId="info-vision"
            />
            <StatusRow
              label="Data storage"
              ok={info.persistentStorage}
              okText="Persistent volume (/data)"
              badText={info.environment === "production" ? "Not on a volume — data may be lost on redeploy" : "Local file (development)"}
              testId="info-storage"
            />
          </div>
        )}
      </Card>
    </div>
  );
}

function Row({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">{label}</div>
      <div className="text-sm mt-1 font-medium text-card-foreground" data-testid={testId}>{value}</div>
    </div>
  );
}

function StatusRow({
  label,
  ok,
  okText,
  badText,
  testId,
}: {
  label: string;
  ok: boolean;
  okText: string;
  badText: string;
  testId: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">{label}</div>
      <div
        className={`text-sm mt-1 font-medium flex items-center gap-1.5 ${ok ? "text-[hsl(120_60%_35%)]" : "text-[hsl(0_72%_45%)]"}`}
        data-testid={testId}
      >
        {ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
        {ok ? okText : badText}
      </div>
    </div>
  );
}
