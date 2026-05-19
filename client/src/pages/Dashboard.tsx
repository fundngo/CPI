import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, ArrowUpRight, Users, TrendingUp, CheckCircle2, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import type { Client, ClientStatus } from "@shared/schema";
import { CLIENT_STATUSES } from "@shared/schema";
import { fmtDate, readinessLabel } from "@/lib/calculations";

export default function Dashboard() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const filtered = useMemo(() => {
    return clients
      .filter((c) =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.email.toLowerCase().includes(search.toLowerCase()) ||
        c.phone.includes(search)
      )
      .filter((c) => statusFilter === "all" || c.status === statusFilter);
  }, [clients, search, statusFilter]);

  const stats = useMemo(() => {
    const total = clients.length;
    const ready = clients.filter((c) => c.status === "Funding Ready" || c.status === "Approved").length;
    const inProgress = clients.filter((c) => c.status === "In Progress").length;
    const newCount = clients.filter((c) => c.status === "New").length;
    return { total, ready, inProgress, newCount };
  }, [clients]);

  return (
    <div className="px-10 py-10 max-w-6xl mx-auto">
      <header className="flex items-start justify-between mb-10">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white" data-testid="text-page-title">
            Client Dashboard
          </h1>
          <p className="text-base text-white/70 mt-2">
            Track every client's funding journey in one place.
          </p>
        </div>
        <Link href="/clients/new">
          <Button data-testid="button-new-client" className="gap-2 rounded-lg px-5 py-2.5 font-medium">
            <Plus className="h-4 w-4" />
            New Client
          </Button>
        </Link>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="Total Clients"
          value={stats.total.toString()}
          testId="stat-total"
        />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
          label="Funding Ready / Approved"
          value={stats.ready.toString()}
          testId="stat-ready"
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4 text-blue-600" />}
          label="In Progress"
          value={stats.inProgress.toString()}
          testId="stat-progress"
        />
        <StatCard
          icon={<Clock className="h-4 w-4 text-slate-500" />}
          label="New Clients"
          value={stats.newCount.toString()}
          testId="stat-new"
        />
      </div>

      <Card className="border-card-border shadow-lg rounded-xl overflow-hidden">
        <div className="p-4 flex flex-col sm:flex-row gap-3 border-b border-card-border">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              data-testid="input-search-clients"
              placeholder="Search clients by name, email, or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-white border-slate-200 text-card-foreground"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-48" data-testid="select-status-filter">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {CLIENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs uppercase tracking-wide text-card-foreground/70">
                <th className="px-6 py-3 font-medium">Client</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">Funding Readiness</th>
                <th className="px-6 py-3 font-medium">Onboarded</th>
                <th className="px-6 py-3 font-medium">Last Updated</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-6 py-4"><Skeleton className="h-5 w-40" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-5 w-24" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-5 w-32" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-5 w-24" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-5 w-24" /></td>
                      <td className="px-6 py-4"></td>
                    </tr>
                  ))}
                </>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center text-sm text-slate-500" data-testid="text-empty">
                    {clients.length === 0
                      ? "No clients yet. Add your first client to get started."
                      : "No clients match your search."}
                  </td>
                </tr>
              )}
              {filtered.map((client) => {
                // Use cached creditUtilization (not exact since cards aren't loaded here)
                const score = client.fundingReadinessScoreOverride ?? estimateScore(client);
                const { label, color } = readinessLabel(score);
                return (
                  <tr key={client.id} className="border-t border-slate-200 hover:bg-slate-50 transition-colors" data-testid={`row-client-${client.id}`}>
                    <td className="px-6 py-4">
                      <div className="font-medium text-card-foreground" data-testid={`text-client-name-${client.id}`}>{client.name}</div>
                      <div className="text-xs text-slate-500">{client.email || client.phone || "—"}</div>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={client.status as ClientStatus} />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-24 h-2 rounded-full bg-slate-200 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${score}%`, backgroundColor: color }}
                          />
                        </div>
                        <span className="text-sm font-semibold tabular-nums" style={{ color }} data-testid={`text-score-${client.id}`}>
                          {score}
                        </span>
                        <span className="text-xs text-slate-500 hidden md:inline">{label}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">{fmtDate(client.onboardingDate)}</td>
                    <td className="px-6 py-4 text-sm text-slate-600">{fmtDate(client.lastUpdated)}</td>
                    <td className="px-6 py-4 text-right">
                      <Link href={`/clients/${client.id}`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid={`button-open-${client.id}`}
                          className="gap-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                        >
                          Open
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value, testId }: { icon: React.ReactNode; label: string; value: string; testId: string }) {
  return (
    <Card className="p-6 border-card-border shadow-lg rounded-xl bg-white">
      <div className="flex items-center gap-2 text-[11px] text-slate-500 uppercase tracking-[0.1em] font-semibold">
        {icon}
        {label}
      </div>
      <div className="mt-3 text-3xl font-bold tabular-nums text-card-foreground" data-testid={testId}>{value}</div>
    </Card>
  );
}

// Rough score estimate without cards (uses cached util %)
function estimateScore(c: Client): number {
  let pb = 0;
  if (c.numBankAccounts >= 4) pb = 80;
  else if (c.numBankAccounts === 3) pb = 60;
  else if (c.numBankAccounts === 2) pb = 40;
  else if (c.numBankAccounts === 1) pb = 20;
  if (c.hasSavings) pb += 10;
  if (c.hasRetirement401k) pb += 10;
  pb = Math.min(100, pb);

  let bb = 0;
  if (c.activeLLC) bb += 20;
  if (c.hasBusinessAccounts) bb += 20;
  if (c.generatingRevenue) bb += 30;
  if (c.hasBusinessProducts) bb += 15;
  if (c.gettingOffersInMail) bb += 15;

  const util = c.creditUtilization || 0;
  let us = 0;
  if (util < 10) us = 100;
  else if (util < 20) us = 85;
  else if (util < 30) us = 70;
  else if (util < 50) us = 50;
  else if (util < 75) us = 25;

  const m = c.monthlyRevenue || 0;
  let br = 0;
  if (m >= 50000) br = 100;
  else if (m >= 20000) br = 85;
  else if (m >= 5000) br = 60;
  else if (m >= 1) br = 30;

  let missing = 0;
  try { const arr = JSON.parse(c.missingDocuments || "[]"); if (Array.isArray(arr)) missing = arr.length; } catch {}
  const deduction = Math.min(20, missing * 5);
  return Math.max(0, Math.min(100, Math.round(0.25 * pb + 0.25 * bb + 0.25 * us + 0.25 * br - deduction)));
}
