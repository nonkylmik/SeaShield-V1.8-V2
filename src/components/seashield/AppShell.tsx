import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  Bell,
  Camera,
  Cpu,
  FileBarChart,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Radar,
  Search,
  Settings,
  Ship,
  ShieldHalf,
  Waves,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useSeaShield, useTelemetryClock } from "@/lib/seashield/useSeaShield";
import { securityService, vesselService } from "@/lib/seashield/services";
import { utcTime, stateColor, severityText } from "@/lib/seashield/format";
import { StatusDot } from "./primitives";
import { connectSeaShieldBackend } from "@/lib/seashield/backend";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, key: "F1" },
  { to: "/fleet", label: "Fleet", icon: Waves, key: "F2" },
  { to: "/vessels", label: "Vessels", icon: Ship, key: "F3" },
  { to: "/cameras", label: "Cameras", icon: Camera, key: "F4" },
  { to: "/cybersecurity", label: "Cybersecurity", icon: ShieldHalf, key: "F5" },
  { to: "/incidents", label: "Incidents", icon: AlertTriangle, key: "F6" },
  { to: "/sensors", label: "Sensors", icon: Gauge, key: "F7" },
  { to: "/access-control", label: "Access Control", icon: KeyRound, key: "F8" },
  { to: "/reports", label: "Reports", icon: FileBarChart, key: "F9" },
  { to: "/settings", label: "Settings", icon: Settings, key: "F10" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  useTelemetryClock();
  useEffect(() => connectSeaShieldBackend(), []);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[13.5rem] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
          <div className="flex-1 overflow-auto py-2">
            {NAV.map((item) => {
              const active =
                item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "group flex items-center gap-2.5 border-l-2 px-3 py-2 text-sm text-sidebar-foreground transition-colors",
                    active
                      ? "border-sidebar-primary bg-sidebar-accent text-sidebar-accent-foreground"
                      : "border-transparent hover:border-sidebar-border hover:bg-sidebar-accent/50",
                  )}
                >
                  <item.icon
                    className={cn("size-4 shrink-0", active ? "text-sidebar-primary" : "text-muted-foreground")}
                  />
                  <span className="flex-1 truncate">{item.label}</span>
                  <span className="tabular text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100">
                    {item.key}
                  </span>
                </Link>
              );
            })}
          </div>
          <SidebarFooter />
        </nav>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
      </div>
      <StatusStrip />
    </div>
  );
}

function TopBar() {
  const vessels = useSeaShield((s) => s.vessels);
  const selected = useSeaShield((s) => s.selectedVesselId);
  const notifications = useSeaShield((s) => s.notifications);
  const operator = useSeaShield((s) => s.operator);
  const summary = useMemo(() => securityService.fleetSummary("all"), [vessels]);
  const unread = notifications.filter((n) => !n.read).length;
  const [openNotif, setOpenNotif] = useState(false);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-panel-header px-3">
      <div className="flex items-center gap-2 pr-3">
        <div className="relative flex size-7 items-center justify-center rounded-sm bg-signal/15 ring-1 ring-signal/40">
          <Radar className="size-4 text-signal" />
        </div>
        <div className="leading-none">
          <div className="text-sm font-semibold tracking-[0.18em]">SEASHIELD</div>
          <div className="label-mono text-[9px]">Maritime Security Ops</div>
        </div>
      </div>

      <select
        aria-label="Fleet and vessel selector"
        value={selected}
        onChange={(e) => vesselService.select(e.target.value)}
        className="h-8 w-64 rounded-sm border border-input bg-background px-2 font-mono text-xs text-foreground outline-none focus:border-ring"
      >
        <option value="all">ALL VESSELS — Fleet view ({vessels.length})</option>
        {vessels.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name} · {v.imo}
          </option>
        ))}
      </select>

      <GlobalSearch />

      <div className="ml-auto flex items-center gap-3">
        <div className="hidden items-center gap-2 border border-border px-2 py-1 lg:flex">
          <StatusDot state={summary.fleetState} />
          <span className={cn("label-mono", stateColor[summary.fleetState])}>
            Fleet {summary.fleetState}
          </span>
          <span className="label-mono">· score {summary.avgScore}</span>
        </div>

        <div className="relative">
          <button
            onClick={() => {
              setOpenNotif((o) => !o);
              if (!openNotif) securityService.markNotificationsRead();
            }}
            className="relative flex size-8 items-center justify-center rounded-sm border border-border hover:bg-accent"
            aria-label="Notifications"
          >
            <Bell className="size-4" />
            {unread > 0 ? (
              <span className="absolute -top-1.5 -right-1.5 min-w-4 rounded-full bg-critical px-1 text-center font-mono text-[10px] text-critical-foreground">
                {unread}
              </span>
            ) : null}
          </button>
          {openNotif ? (
            <div className="absolute right-0 z-50 mt-1 w-96 rounded-sm border border-border bg-popover shadow-panel">
              <div className="label-mono border-b border-border px-3 py-2">Notifications</div>
              <ul className="max-h-80 overflow-auto">
                {notifications.map((n) => (
                  <li key={n.id} className="border-b border-border/60 px-3 py-2 last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn("text-xs font-semibold", severityText[n.severity])}>
                        {n.title}
                      </span>
                      <span className="tabular text-[10px] text-muted-foreground">{utcTime(n.ts)}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2 border-l border-border pl-3">
          <div className="flex size-7 items-center justify-center rounded-sm bg-secondary font-mono text-[11px]">
            RV
          </div>
          <div className="hidden leading-tight xl:block">
            <div className="text-xs font-medium">{operator.name}</div>
            <div className="label-mono text-[9px] normal-case">{operator.role}</div>
          </div>
        </div>
      </div>
    </header>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState("");
  const vessels = useSeaShield((s) => s.vessels);
  const incidents = useSeaShield((s) => s.incidents);
  const results = useMemo(() => {
    if (q.trim().length < 2) return [];
    const t = q.toLowerCase();
    return [
      ...vessels
        .filter((v) => (v.name + v.imo).toLowerCase().includes(t))
        .map((v) => ({ id: v.id, kind: "Vessel", label: `${v.name} · ${v.imo}`, to: `/vessels/${v.id}` })),
      ...incidents
        .filter((i) => (i.ref + i.title).toLowerCase().includes(t))
        .map((i) => ({ id: i.id, kind: "Incident", label: `${i.ref} · ${i.title}`, to: `/incidents` })),
    ].slice(0, 8);
  }, [q, vessels, incidents]);

  return (
    <div className="relative w-72">
      <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search vessels, incidents…  (Ctrl+K)"
        className="h-8 w-full rounded-sm border border-input bg-background pl-7 font-mono text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
        id="seashield-global-search"
      />
      {results.length ? (
        <ul className="absolute z-50 mt-1 w-full rounded-sm border border-border bg-popover shadow-panel">
          {results.map((r) => (
            <li key={r.kind + r.id}>
              <Link
                to={r.to}
                onClick={() => setQ("")}
                className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent"
              >
                <span className="label-mono w-14">{r.kind}</span>
                <span className="truncate">{r.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SidebarFooter() {
  const connection = useSeaShield((s) => s.connection);
  return (
    <div className="space-y-1.5 border-t border-sidebar-border px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="label-mono">Edge node</span>
        <span className="flex items-center gap-1.5">
          <StatusDot state={connection.edge} />
          <span className="tabular text-[10px] text-secure">LINKED</span>
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="label-mono">Backend</span>
        <span className="flex items-center gap-1.5">
          <StatusDot state={connection.backend} pulse={false} />
          <span className="tabular text-[10px] text-muted-foreground">V1.8 API</span>
        </span>
      </div>
      <div className="label-mono flex items-center gap-1.5 border border-signal/30 bg-signal/8 px-1.5 py-1 text-signal">
        <Cpu className="size-3" /> {connection.mode}
      </div>
    </div>
  );
}

function StatusStrip() {
  const events = useSeaShield((s) => s.events);
  const incidents = useSeaShield((s) => s.incidents);
  const [clock, setClock] = useState<string | null>(null);

  useEffect(() => {
    const set = () => setClock(utcTime(Date.now()));
    set();
    const id = window.setInterval(set, 1000);
    return () => window.clearInterval(id);
  }, []);

  const last = events[0];
  const open = incidents.filter((i) => i.status !== "closed").length;

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-border bg-panel-header px-3">
      <span className="label-mono flex items-center gap-1.5">
        <Activity className="size-3 text-signal" /> Live feed
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
        {last ? `${utcTime(last.ts)} · ${last.title} — ${last.detail}` : "No events"}
      </span>
      <span className="label-mono">Open incidents {open}</span>
      <span className="label-mono">Workstation OPS-01</span>
      <span className="tabular text-[11px] text-foreground">{clock ?? "--:--:--Z"}</span>
    </footer>
  );
}
