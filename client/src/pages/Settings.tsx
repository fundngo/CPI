import { Card } from "@/components/ui/card";
import { Settings as SettingsIcon, ShieldCheck, Mail, Phone } from "lucide-react";

export default function Settings() {
  return (
    <div className="px-10 py-10 max-w-4xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3" data-testid="text-settings-title">
          <SettingsIcon className="h-7 w-7" />
          Settings
        </h1>
        <p className="text-base text-white/70 mt-2">
          Workspace info and consultant details.
        </p>
      </header>

      <Card className="p-8 border-card-border shadow-lg rounded-xl space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <div className="font-semibold">Fund & Go</div>
            <div className="text-sm text-muted-foreground">Credit & Funding Intake</div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4 border-t border-border">
          <Row label="Consultant" value="David Sanchez" />
          <Row label="Role" value="Credit & Funding Consultant" />
          <Row label="Email" value="david@getyouright.consulting" icon={<Mail className="h-3.5 w-3.5" />} />
          <Row label="Phone" value="(555) 555-0199" icon={<Phone className="h-3.5 w-3.5" />} />
        </div>
      </Card>

      <Card className="p-8 border-card-border shadow-lg rounded-xl mt-6">
        <h2 className="text-xl font-bold text-card-foreground mb-3">About CPI</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          CPI (Client Profile Intake) keeps every client's banking, business, and credit picture in
          one organized record. Funding readiness, utilization, and next steps are calculated
          automatically so you can focus on what to do next — not on chasing spreadsheets.
        </p>
      </Card>
    </div>
  );
}

function Row({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-1.5">
        {icon}
        {label}
      </div>
      <div className="text-sm mt-1 font-medium">{value}</div>
    </div>
  );
}
