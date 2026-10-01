import { appendSafetyRounds, hydrateFromBackend, setOperator } from "./store";
import type {
  Camera,
  Incident,
  SafetyCheckpointStatus,
  SafetyFinding,
  SafetyFindingStatus,
  SafetyRound,
  SafetyRoundTemplate,
  SecurityEvent,
  Severity,
  Vessel,
} from "./types";

const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const WS_URL = API_URL.replace(/^http/, "ws") + "/ws/security";

type ApiVessel = {
  id: string;
  name: string;
  imo: string;
  score: number;
  status: string;
  last_communication?: string;
};
type ApiCamera = {
  id: string;
  vessel_id: string;
  location: string;
  online: boolean;
  recording: boolean;
  last_heartbeat?: string;
};
type ApiEvent = {
  id?: string;
  event_id?: string;
  acknowledged?: boolean;
  timestamp: string;
  vessel_id: string;
  event_type: string;
  category: string;
  severity: string;
  source: string;
  description: string;
  title?: string;
  status?: string;
};
type ApiIncident = {
  incident_id: string;
  vessel_id: string;
  title: string;
  type: string;
  severity: string;
  status: string;
  created_at: string;
  updated_at: string;
  related_event_ids?: string[];
  assigned_operator?: string;
  investigation_notes?: string;
  notes?: Array<{ note_id: string; author: string; body: string; created_at: string }>;
  timeline?: Array<{ id: string; text: string; created_at: string }>;
};

const severity = (value: string): Severity => {
  const normalized = value.toLowerCase();
  return ["critical", "high", "medium", "low", "info"].includes(normalized)
    ? (normalized as Severity)
    : "info";
};
const stateFor = (score: number): Vessel["securityState"] =>
  score >= 86 ? "secure" : score >= 72 ? "elevated" : score >= 55 ? "warning" : "critical";
const HAS_TIMEZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const dateMs = (value?: string) => {
  if (!value) return Date.now();
  const iso = value.replace(" ", "T");
  const parsed = Date.parse(HAS_TIMEZONE.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(parsed) ? Date.now() : parsed;
};
let refreshSequence = 0;

function eventCategory(event: ApiEvent): SecurityEvent["category"] {
  const type = event.event_type.toLowerCase();
  if (type.includes("camera")) return "camera";
  if (type.includes("access")) return "access";
  if (
    type.includes("sensor") ||
    type.includes("smoke") ||
    type.includes("fire") ||
    type.includes("temperature")
  )
    return "sensor";
  if (type.includes("gps") || type.includes("ais")) return "navigation";
  return event.category.toLowerCase() === "cyber" ? "cyber" : "system";
}
function incidentStatus(value: string): Incident["status"] {
  const normalized = value.toLowerCase();
  if (normalized === "new") return "open";
  if (normalized === "resolved" || normalized === "false positive") return "closed";
  return ["open", "investigating", "contained", "closed"].includes(normalized)
    ? (normalized as Incident["status"])
    : "open";
}
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) throw new Error(`SeaShield API request failed (${response.status})`);
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}

export async function readBackendAuth() {
  const config = await request<{ auth_required: boolean }>("/api/auth/config");
  if (!config.auth_required) return { required: false, authenticated: true };
  try {
    const user = await request<{ email: string; name: string; role: string }>("/api/auth/me");
    setOperator(user.name, user.role);
    return { required: true, authenticated: true };
  } catch {
    return { required: true, authenticated: false };
  }
}

export async function loginBackend(email: string, password: string) {
  const response = await request<{ user: { name: string; role: string } }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setOperator(response.user.name, response.user.role);
  await refreshSeaShieldBackend();
}

export async function logoutBackend() {
  await request<void>("/api/auth/logout", { method: "POST" });
}

export async function refreshSeaShieldBackend() {
  const sequence = ++refreshSequence;
  const [health, vessels, cameras, events, incidents, safetyRounds, safetyFindings] =
    await Promise.all([
      request<{ status: string }>("/health"),
      request<ApiVessel[]>("/api/v1/vessels"),
      request<ApiCamera[]>("/api/v1/cameras"),
      request<ApiEvent[]>("/api/security-events?limit=100"),
      request<ApiIncident[]>("/api/v1/incidents"),
      request<SafetyRound[]>("/api/v1/safety-rounds?limit=100"),
      request<SafetyFinding[]>("/api/v1/safety-findings?limit=100"),
    ]);
  if (sequence !== refreshSequence) return;
  hydrateFromBackend({
    health: health.status,
    vessels: vessels.map((v) => ({
      id: v.id,
      name: v.name,
      imo: v.imo,
      score: v.score,
      state: stateFor(v.score),
      lastComms: dateMs(v.last_communication),
    })),
    cameras: cameras.map((c) => ({
      id: c.id,
      vesselId: c.vessel_id,
      location: c.location,
      online: c.online,
      recording: c.recording,
      lastFrame: dateMs(c.last_heartbeat),
    })),
    events: events.map((e) => ({
      id: e.event_id ?? String(e.id ?? crypto.randomUUID()),
      ts: dateMs(e.timestamp),
      vesselId: e.vessel_id,
      category: eventCategory(e),
      severity: severity(e.severity),
      title: e.title ?? e.event_type.replaceAll("_", " "),
      detail: e.description,
      source: e.source,
      acknowledged: Boolean(e.acknowledged) || e.status?.toLowerCase() === "resolved",
    })),
    incidents: incidents.map((i) => ({
      id: i.incident_id,
      ref: i.incident_id,
      title: i.title,
      vesselId: i.vessel_id,
      system: i.type,
      severity: severity(i.severity),
      status: incidentStatus(i.status),
      assignee: i.assigned_operator ?? "Security Operator",
      openedAt: dateMs(i.created_at),
      updatedAt: dateMs(i.updated_at),
      eventIds: i.related_event_ids ?? [],
      notes: i.notes?.length
        ? i.notes.map((note) => ({
            id: note.note_id,
            ts: dateMs(note.created_at),
            author: note.author,
            body: note.body,
          }))
        : i.investigation_notes
          ? [
              {
                id: `${i.incident_id}-note`,
                ts: dateMs(i.updated_at),
                author: i.assigned_operator ?? "Security Operator",
                body: i.investigation_notes,
              },
            ]
          : [],
      timeline: i.timeline?.length
        ? i.timeline.map((item) => ({ id: item.id, ts: dateMs(item.created_at), text: item.text }))
        : [
            {
              id: `${i.incident_id}-opened`,
              ts: dateMs(i.created_at),
              text: "Incident opened by the V1.8 correlation engine.",
            },
          ],
    })),
    safetyRounds,
    safetyFindings,
  });
}

export async function listSafetyRounds(
  filters: {
    vesselId?: string;
    roundType?: string;
    status?: string;
    assignedTo?: string;
    start?: string;
    end?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const params = new URLSearchParams();
  if (filters.vesselId) params.set("vessel_id", filters.vesselId);
  if (filters.roundType) params.set("round_type", filters.roundType);
  if (filters.status) params.set("status", filters.status);
  if (filters.assignedTo) params.set("assigned_to", filters.assignedTo);
  if (filters.start) params.set("start", filters.start);
  if (filters.end) params.set("end", filters.end);
  params.set("limit", String(filters.limit ?? 50));
  params.set("offset", String(filters.offset ?? 0));
  return request<SafetyRound[]>(`/api/v1/safety-rounds?${params}`);
}

export async function loadMoreSafetyRounds(
  offset: number,
  filters: Parameters<typeof listSafetyRounds>[0] = {},
) {
  const rows = await listSafetyRounds({ ...filters, limit: 50, offset });
  appendSafetyRounds(rows);
  return rows.length;
}

export async function listSafetyRoundTemplates() {
  return request<SafetyRoundTemplate[]>("/api/v1/safety-round-templates");
}

export async function createSafetyRound(input: {
  vessel_id: string;
  round_type: string;
  assigned_to: string;
  planned_start: string;
  notes: string;
  template_name: string;
}) {
  const round = await request<SafetyRound>("/api/v1/safety-rounds", {
    method: "POST",
    body: JSON.stringify(input),
  });
  await refreshSeaShieldBackend();
  return round;
}

export async function startSafetyRound(roundId: string) {
  const round = await request<SafetyRound>(
    `/api/v1/safety-rounds/${encodeURIComponent(roundId)}/start`,
    { method: "POST" },
  );
  await refreshSeaShieldBackend();
  return round;
}

export async function completeSafetyRound(roundId: string) {
  const round = await request<SafetyRound>(
    `/api/v1/safety-rounds/${encodeURIComponent(roundId)}/complete`,
    { method: "POST" },
  );
  await refreshSeaShieldBackend();
  return round;
}

export async function cancelSafetyRound(roundId: string) {
  const round = await request<SafetyRound>(
    `/api/v1/safety-rounds/${encodeURIComponent(roundId)}/cancel`,
    { method: "POST" },
  );
  await refreshSeaShieldBackend();
  return round;
}

export async function updateSafetyCheckpoint(
  roundId: string,
  checkpointId: string,
  input: {
    status?: SafetyCheckpointStatus;
    severity?: SafetyFinding["severity"];
    notes?: string;
    completed_by?: string;
  },
) {
  const result = await request(
    `/api/v1/safety-rounds/${encodeURIComponent(roundId)}/checkpoints/${encodeURIComponent(checkpointId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  await refreshSeaShieldBackend();
  return result;
}

export async function updateSafetyFinding(
  findingId: string,
  input: {
    status?: SafetyFindingStatus;
    severity?: SafetyFinding["severity"];
    assigned_to?: string;
    due_date?: string | null;
    resolution_notes?: string;
  },
) {
  const finding = await request<SafetyFinding>(
    `/api/v1/safety-findings/${encodeURIComponent(findingId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  await refreshSeaShieldBackend();
  return finding;
}
const scenarioEventMap: Record<string, string> = {
  "camera-failure": "CAMERA_OFFLINE",
  "unauthorized-access": "UNAUTHORIZED_ACCESS",
  "unknown-device": "UNKNOWN_DEVICE",
  "brute-force": "FAILED_AUTHENTICATION",
  "suspicious-traffic": "SUSPICIOUS_TRAFFIC",
  "firewall-block": "FIREWALL_BLOCK",
  "gps-anomaly": "GPS_ANOMALY",
  "sensor-failure": "SENSOR_FAILURE",
  "fire-alarm": "FIRE_ALARM",
};
export async function runBackendScenario(uiScenario: string, vesselId: string) {
  const eventType = scenarioEventMap[uiScenario];
  if (!eventType) throw new Error(`No backend event is mapped to ${uiScenario}.`);
  const result = await request<{ correlation?: { title: string } }>("/api/v1/simulation/inject", {
    method: "POST",
    body: JSON.stringify({ vessel_id: vesselId, event_type: eventType }),
  });
  await refreshSeaShieldBackend();
  return result.correlation
    ? `${eventType.replaceAll("_", " ")} injected · correlated: ${result.correlation.title}`
    : `${eventType.replaceAll("_", " ")} injected for ${vesselId}.`;
}
export async function resetBackendSimulation() {
  await request("/api/v1/simulation/reset", { method: "POST" });
  await refreshSeaShieldBackend();
}
export async function updateBackendIncident(
  id: string,
  patch: Partial<{ status: Incident["status"]; severity: Severity; assignee: string }>,
  actor?: string,
) {
  const backendStatus: Record<Incident["status"], string> = {
    open: "NEW",
    investigating: "INVESTIGATING",
    contained: "CONTAINED",
    closed: "RESOLVED",
  };
  await request(`/api/v1/incidents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...(patch.status ? { status: backendStatus[patch.status] } : {}),
      ...(patch.severity ? { severity: patch.severity.toUpperCase() } : {}),
      ...(patch.assignee ? { assigned_operator: patch.assignee } : {}),
      ...(actor ? { actor } : {}),
    }),
  });
  await refreshSeaShieldBackend();
}

export async function createBackendIncident(input: {
  title: string;
  vesselId: string;
  system: string;
  severity: Severity;
  assignee: string;
}) {
  const incident = await request<ApiIncident>("/api/v1/incidents", {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      vessel_id: input.vesselId,
      type: input.system,
      severity: input.severity.toUpperCase(),
      assigned_operator: input.assignee,
    }),
  });
  await refreshSeaShieldBackend();
  return incident;
}

export async function addBackendIncidentNote(id: string, body: string, author: string) {
  await request(`/api/v1/incidents/${encodeURIComponent(id)}/notes`, {
    method: "POST",
    body: JSON.stringify({ body, author }),
  });
  await refreshSeaShieldBackend();
}

export async function acknowledgeBackendEvent(id: string, acknowledgedBy: string) {
  await request(`/api/security-events/${encodeURIComponent(id)}/acknowledge`, {
    method: "POST",
    body: JSON.stringify({ acknowledged_by: acknowledgedBy }),
  });
  await refreshSeaShieldBackend();
}
const REFRESH_DEBOUNCE_MS = 250;
const MAX_RECONNECT_DELAY_MS = 30_000;
let socket: WebSocket | undefined;
let consumers = 0;
let reconnectAttempt = 0;
let reconnectTimer: number | undefined;
let refreshTimer: number | undefined;

function scheduleRefresh(delay = REFRESH_DEBOUNCE_MS) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    void refreshSeaShieldBackend().catch(() => hydrateFromBackend({ health: "degraded" }));
  }, delay);
}

function openSocket() {
  if (socket || consumers === 0) return;
  let ws: WebSocket;
  try {
    ws = new WebSocket(WS_URL);
  } catch {
    scheduleReconnect();
    return;
  }
  socket = ws;
  ws.onopen = () => {
    reconnectAttempt = 0;
    ws.send("seashield-ui");
    scheduleRefresh(0);
  };
  ws.onmessage = () => scheduleRefresh();
  ws.onerror = () => ws.close();
  ws.onclose = () => {
    if (socket === ws) socket = undefined;
    if (consumers === 0) return;
    hydrateFromBackend({ health: "degraded" });
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (consumers === 0 || reconnectTimer !== undefined) return;
  const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** reconnectAttempt);
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    openSocket();
  }, delay);
}

export function connectSeaShieldBackend() {
  consumers += 1;
  scheduleRefresh(0);
  openSocket();
  return () => {
    consumers = Math.max(0, consumers - 1);
    if (consumers > 0) return;
    window.clearTimeout(reconnectTimer);
    window.clearTimeout(refreshTimer);
    reconnectTimer = undefined;
    refreshTimer = undefined;
    const activeSocket = socket;
    socket = undefined;
    activeSocket?.close();
  };
}
