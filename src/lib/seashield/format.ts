import type { OnlineState, SecurityState, Severity } from "./types";

/** Absolute UTC formatting keeps SSR and client output identical. */
export function utcTime(ts: number) {
  const d = new Date(ts);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(
    d.getUTCSeconds(),
  ).padStart(2, "0")}Z`;
}

export function utcStamp(ts: number) {
  const d = new Date(ts);
  const day = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
  return `${day} ${utcTime(ts)}`;
}

export function elapsed(from: number, to: number) {
  const s = Math.max(0, Math.round((to - from) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

export const severityText: Record<Severity, string> = {
  critical: "text-critical",
  high: "text-warning",
  medium: "text-caution",
  low: "text-signal",
  info: "text-muted-foreground",
};

export const severityBg: Record<Severity, string> = {
  critical: "bg-critical/15 text-critical border-critical/40",
  high: "bg-warning/15 text-warning border-warning/40",
  medium: "bg-caution/15 text-caution border-caution/40",
  low: "bg-signal/15 text-signal border-signal/40",
  info: "bg-muted text-muted-foreground border-border",
};

export const stateColor: Record<SecurityState, string> = {
  secure: "text-secure",
  elevated: "text-caution",
  warning: "text-warning",
  critical: "text-critical",
};

export const stateDot: Record<SecurityState, string> = {
  secure: "bg-secure",
  elevated: "bg-caution",
  warning: "bg-warning",
  critical: "bg-critical",
};

export const onlineDot: Record<OnlineState, string> = {
  online: "bg-secure",
  degraded: "bg-caution",
  offline: "bg-critical",
};

export const onlineText: Record<OnlineState, string> = {
  online: "text-secure",
  degraded: "text-caution",
  offline: "text-critical",
};
