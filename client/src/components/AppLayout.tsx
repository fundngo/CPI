import { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Settings, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Client } from "@shared/schema";
import logoUrl from "@/assets/fund-go-logo.png";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  testId: string;
}

const nav: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, testId: "link-nav-dashboard" },
  { href: "/settings", label: "Settings", icon: Settings, testId: "link-nav-settings" },
];

function BrandHeader() {
  return (
    <div className="flex flex-col gap-2">
      <img
        src={logoUrl}
        alt="Fund & Go"
        className="h-12 w-auto object-contain"
        data-testid="img-brand-logo"
      />
      <div
        className="text-[10px] font-semibold tracking-[0.16em] uppercase text-white/60"
        data-testid="text-brand-subtitle"
      >
        Client Profile Intake
      </div>
    </div>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { data: clients = [] } = useQuery<Client[]>({ queryKey: ["/api/clients"] });

  const recentClients = [...clients]
    .sort((a, b) => (b.lastUpdated || "").localeCompare(a.lastUpdated || ""))
    .slice(0, 5);

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-60 shrink-0 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border">
        {/* Brand */}
        <div className="px-5 pt-6 pb-5">
          <BrandHeader />
        </div>

        {/* Primary CTA */}
        <div className="px-3 pb-3">
          <Link href="/clients/new" data-testid="link-nav-add-client">
            <button
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors",
                "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
              data-testid="button-new-client-sidebar"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              <span>New Client</span>
            </button>
          </Link>
        </div>

        {/* Workspace nav */}
        <div className="px-3 pt-2">
          <div className="px-3 pb-2 text-[10px] font-semibold tracking-[0.12em] uppercase text-white/50">
            Workspace
          </div>
          <nav className="space-y-0.5">
            {nav.map((item) => {
              const active = item.href === "/"
                ? location === "/" || (location.startsWith("/clients/") && location !== "/clients/new")
                : location === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-testid={item.testId}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
                    active
                      ? "bg-primary text-primary-foreground font-medium"
                      : "text-white/80 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Recent clients */}
        <div className="px-3 pt-6 flex-1 min-h-0 flex flex-col">
          <div className="px-3 pb-2 text-[10px] font-semibold tracking-[0.12em] uppercase text-white/50">
            Recent Clients
          </div>
          <div className="space-y-0.5 overflow-y-auto">
            {recentClients.length === 0 && (
              <div className="px-3 py-2 text-xs text-white/50">
                No clients yet
              </div>
            )}
            {recentClients.map((c) => {
              const active = location === `/clients/${c.id}`;
              return (
                <Link
                  key={c.id}
                  href={`/clients/${c.id}`}
                  data-testid={`link-sidebar-client-${c.id}`}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors truncate",
                    active
                      ? "bg-primary text-primary-foreground font-medium"
                      : "text-white/80 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <span className="truncate">{c.name}</span>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-sidebar-border">
          <div className="text-[11px] text-white/40 leading-snug">
            Credit &amp; Funding Tools
          </div>
        </div>
      </aside>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
