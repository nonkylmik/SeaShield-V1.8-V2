import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { onlineDot, onlineText, severityBg, stateDot } from "@/lib/seashield/format";
import type { OnlineState, SecurityState, Severity } from "@/lib/seashield/types";

export function Panel({
  title,
  meta,
  actions,
  children,
  className,
  bodyClassName,
  scroll,
}: {
  title?: string | undefined;
  meta?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
  bodyClassName?: string | undefined;
  scroll?: boolean | undefined;
}) {
  return (
    <section
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-sm border border-border bg-panel shadow-panel",
        className,
      )}
    >
      {title ? (
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-panel-header px-3 py-2">
          <div className="flex items-baseline gap-3">
            <h2 className="label-mono text-foreground">{title}</h2>
            {meta ? <span className="label-mono">{meta}</span> : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className={cn("min-h-0 flex-1", scroll && "overflow-auto", bodyClassName)}>{children}</div>
    </section>
  );
}

export function SeverityTag({ severity }: { severity: Severity }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-1.5 py-px font-mono text-[10px] font-semibold tracking-[0.12em] uppercase",
        severityBg[severity],
      )}
    >
      {severity}
    </span>
  );
}

export function StatusDot({
  state,
  pulse = true,
}: {
  state: SecurityState | OnlineState;
  pulse?: boolean | undefined;
}) {
  const cls =
    state in stateDot
      ? stateDot[state as SecurityState]
      : onlineDot[state as OnlineState];
  return (
    <span className="relative inline-flex size-2 items-center justify-center">
      <span className={cn("size-2 rounded-full", cls)} />
      {pulse ? (
        <span className={cn("absolute size-2 rounded-full opacity-60", cls, "animate-blip")} />
      ) : null}
    </span>
  );
}

export function StateLabel({ state }: { state: OnlineState }) {
  return (
    <span className={cn("tabular text-xs", onlineText[state])}>
      {state === "online" ? "ONLINE" : state === "degraded" ? "DEGRADED" : "OFFLINE"}
    </span>
  );
}

export function Metric({
  label,
  value,
  sub,
  tone = "default",
  children,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode | undefined;
  tone?: "default" | "secure" | "caution" | "warning" | "critical" | "signal" | undefined;
  children?: ReactNode | undefined;
}) {
  const toneCls = {
    default: "text-foreground",
    secure: "text-secure",
    caution: "text-caution",
    warning: "text-warning",
    critical: "text-critical",
    signal: "text-signal",
  }[tone];
  return (
    <div className="flex min-w-0 flex-col justify-between gap-2 border border-border bg-panel px-3 py-2.5">
      <div className="label-mono truncate">{label}</div>
      <div className={cn("tabular text-2xl leading-none font-semibold", toneCls)}>{value}</div>
      {sub ? <div className="label-mono truncate normal-case">{sub}</div> : null}
      {children}
    </div>
  );
}

export function ScoreBar({ score }: { score: number }) {
  const tone =
    score >= 86 ? "bg-secure" : score >= 72 ? "bg-caution" : score >= 55 ? "bg-warning" : "bg-critical";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
      <div className={cn("h-full transition-all duration-500", tone)} style={{ width: `${score}%` }} />
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string | undefined;
  actions?: ReactNode | undefined;
}) {
  return (
    <div className="flex shrink-0 items-end justify-between gap-4 border-b border-border px-4 py-3">
      <div>
        <h1 className="text-base font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="label-mono normal-case">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export function SimBanner({ text }: { text?: string | undefined }) {
  return (
    <div className="label-mono flex items-center gap-2 border border-signal/30 bg-signal/8 px-2.5 py-1 text-signal">
      <span className="size-1.5 rounded-full bg-signal animate-pulse-signal" />
      {text ?? "Simulated data — Prototype V1. No real vessel, camera or network systems connected."}
    </div>
  );
}
