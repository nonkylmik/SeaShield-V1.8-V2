import { hydrateFromBackend } from "./store";
import type { Camera, Incident, SecurityEvent, Severity, Vessel } from "./types";

const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const WS_URL = API_URL.replace(/^http/, "ws") + "/ws/security";

type ApiVessel = { id: string; name: string; imo: string; score: number; status: string; last_communication?: string };
type ApiCamera = { id: string; vessel_id: string; location: string; online: boolean; recording: boolean; last_heartbeat?: string };
type ApiEvent = { id?: string; event_id?: string; timestamp: string; vessel_id: string; event_type: string; category: string; severity: string; source: string; description: string; title?: string; status?: string };
type ApiIncident = { incident_id: string; vessel_id: string; title: string; type: string; severity: string; status: string; created_at: string; updated_at: string; related_event_ids?: string[]; assigned_operator?: string; investigation_notes?: string };

const severity = (value: string): Severity => {
  const normalized = value.toLowerCase();
  return ["critical", "high", "medium", "low", "info"].includes(normalized) ? normalized as Severity : "info";
};
const stateFor = (score: number): Vessel["securityState"] => score >= 86 ? "secure" : score >= 72 ? "elevated" : score >= 55 ? "warning" : "critical";
const dateMs = (value?: string) => value ? Date.parse(value) || Date.now() : Date.now();

function eventCategory(event: ApiEvent): SecurityEvent["category"] {
  const type = event.event_type.toLowerCase();
  if (type.includes("camera")) return "camera";
  if (type.includes("access")) return "access";
  if (type.includes("sensor") || type.includes("smoke") || type.includes("fire") || type.includes("temperature")) return "sensor";
  if (type.includes("gps") || type.includes("ais")) return "navigation";
  return event.category.toLowerCase() === "cyber" ? "cyber" : "system";
}
function incidentStatus(value: string): Incident["status"] {
  const normalized = value.toLowerCase();
  if (normalized === "new") return "open";
  if (normalized === "resolved" || normalized === "false positive") return "closed";
  return ["open", "investigating", "contained", "closed"].includes(normalized) ? normalized as Incident["status"] : "open";
}
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...options, credentials: "include", headers: { "Content-Type": "application/json", ...options?.headers } });
  if (!response.ok) throw new Error(`SeaShield API request failed (${response.status})`);
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export async function refreshSeaShieldBackend() {
  const [health, vessels, cameras, events, incidents] = await Promise.all([request<{ status: string }>("/health"), request<ApiVessel[]>("/api/v1/vessels"), request<ApiCamera[]>("/api/v1/cameras"), request<ApiEvent[]>("/api/security-events?limit=100"), request<ApiIncident[]>("/api/v1/incidents")]);
  hydrateFromBackend({
    health: health.status,
    vessels: vessels.map((v) => ({ id: v.id, name: v.name, imo: v.imo, score: v.score, state: stateFor(v.score), lastComms: dateMs(v.last_communication) })),
    cameras: cameras.map((c) => ({ id: c.id, vesselId: c.vessel_id, location: c.location, online: c.online, recording: c.recording, lastFrame: dateMs(c.last_heartbeat) })),
    events: events.map((e) => ({ id: e.id ?? e.event_id ?? crypto.randomUUID(), ts: dateMs(e.timestamp), vesselId: e.vessel_id, category: eventCategory(e), severity: severity(e.severity), title: e.title ?? e.event_type.replaceAll("_", " "), detail: e.description, source: e.source, acknowledged: e.status?.toLowerCase() === "resolved" })),
    incidents: incidents.map((i) => ({ id: i.incident_id, ref: i.incident_id, title: i.title, vesselId: i.vessel_id, system: i.type, severity: severity(i.severity), status: incidentStatus(i.status), assignee: i.assigned_operator ?? "Security Operator", openedAt: dateMs(i.created_at), updatedAt: dateMs(i.updated_at), eventIds: i.related_event_ids ?? [], notes: i.investigation_notes ? [{ id: `${i.incident_id}-note`, ts: dateMs(i.updated_at), author: i.assigned_operator ?? "Security Operator", body: i.investigation_notes }] : [], timeline: [{ id: `${i.incident_id}-opened`, ts: dateMs(i.created_at), text: "Incident opened by the V1.8 correlation engine." }] })),
  });
}
const scenarioMap: Record<string, string> = { "camera-failure": "physical-breach", "unauthorized-access": "physical-breach", "unknown-device": "cyber-intrusion", "brute-force": "cyber-intrusion", "suspicious-traffic": "cyber-intrusion", "firewall-block": "cyber-intrusion", "gps-anomaly": "navigation-anomaly", "sensor-failure": "fire-emergency", "fire-alarm": "fire-emergency" };
export async function runBackendScenario(uiScenario: string) {
  const scenario = scenarioMap[uiScenario];
  if (!scenario) throw new Error(`No V1.8 scenario is mapped to ${uiScenario}.`);
  await request(`/api/v1/simulation/scenario/${scenario}/start`, { method: "POST" });
  await refreshSeaShieldBackend();
  return `V1.8 ${scenario.replaceAll("-", " ")} scenario advanced.`;
}
export async function resetBackendSimulation() { await request("/api/v1/simulation/reset", { method: "POST" }); await refreshSeaShieldBackend(); }
export async function updateBackendIncident(id: string, status: Incident["status"], notes = "") {
  const backendStatus: Record<Incident["status"], string> = { open: "NEW", investigating: "INVESTIGATING", contained: "CONTAINED", closed: "RESOLVED" };
  await request(`/api/v1/incidents/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status: backendStatus[status], investigation_notes: notes }) });
  await refreshSeaShieldBackend();
}
let socket: WebSocket | undefined;
export function connectSeaShieldBackend() {
  void refreshSeaShieldBackend().catch(() => hydrateFromBackend({ health: "degraded" }));
  if (socket) return () => socket?.close();
  socket = new WebSocket(WS_URL);
  socket.onopen = () => socket?.send("seashield-ui");
  socket.onmessage = () => void refreshSeaShieldBackend().catch(() => undefined);
  socket.onclose = () => { socket = undefined; };
  return () => socket?.close();
}
