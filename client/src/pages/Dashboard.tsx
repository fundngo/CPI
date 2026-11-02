import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, ArrowUpRight, Users, TrendingUp, CheckCircle2, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import type { ClientStatus, ClientWithCards } from "@shared/schema";
import { CLIENT_STATUSES } from "@shared/schema";
import { fmtDate, fundingReadinessScore, readinessLabel } from "@/lib/calculations";

export default function Dashboard() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [, setLocation] = useLocation();

  const { data: clients = [], isLoading } = useQuery<ClientWithCards[]>({
    queryKey: ["/api/clients"],
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return clients
      .filter((c) =>
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (qDigits.length > 0 && c.phone.replace(/\D/g, "").includes(qDigits))
      )
      .filter((c) => statusFilter === "all" || c.status === statusFilter)
      .sort((a, b) => (b.lastUpdated || "").localeCompare(a.lastUpdated || ""));
  }, [clients, search, statusFilter]);

  const stats = useMemo(() => {
    const total = clients.length;
    const ready = clients.filter((c) => c.status === "Funding Ready" || c.status === "Approved").length;
    const inProgress = clients.filter((c) => c.status === "In Progress").length;
    const newCount = clients.filter((c) => c.status === "New").length;
    return { total, ready, inProgress, newCount };
  }, [clients]);

  return (
    <div className="px-6 sm:px-10 py-10 max-w-5xl mx-auto">
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

      {/* Prominent search bar */}
      <div className="mb-5 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-white/50" />
          <Input
            data-testid="input-search-clients"
            placeholder="Search by name, email, or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-12 h-12 text-base bg-white border-white/10 text-card-foreground rounded-xl shadow-lg focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-56 h-12 bg-white rounded-xl shadow-lg" data-testid="select-status-filter">
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

      <Card className="border-card-border shadow-lg rounded-xl overflow-hidden">

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
                const score = fundingReadinessScore(client);
                const { label, color } = readinessLabel(score);
                return (
                  <tr
                    key={client.id}
                    className="border-t border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => setLocation(`/clients/${client.id}`)}
                    data-testid={`row-client-${client.id}`}
                  >
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
                      <Link href={`/clients/${client.id}`} onClick={(e) => e.stopPropagation()}>
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
