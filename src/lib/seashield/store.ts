import { buildSeedState, SIM_EPOCH, cyberSummary } from "./data";
import type {
  Incident,
  IncidentStatus,
  SeaShieldState,
  SecurityEvent,
  Severity,
  Vessel,
} from "./types";

/**
 * In-memory simulation store for Prototype V1.
 * The UI reads through service abstractions (services.ts); this module owns
 * simulated state only. When the Python/FastAPI backend is introduced the
 * services swap to HTTP calls and this module can be retired.
 */

type Listener = () => void;

let state: SeaShieldState = buildSeedState();
const listeners = new Set<Listener>();
let counter = 0;
let clockOffset = 0; // advances simulated time on triggers/ticks

export function now() {
  return SIM_EPOCH + clockOffset;
}

function uid(prefix: string) {
  counter += 1;
  return `${prefix}-${counter.toString(36)}`;
}

function emit() {
  state = { ...state };
  listeners.forEach((l) => l());
}

export function subscribe(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getState() {
  return state;
}

type BackendPayload = {
  health: string;
  vessels?: Array<Pick<Vessel, "id" | "name" | "imo" | "lastComms"> & { score: number; state: Vessel["securityState"] }>;
  cameras?: Array<{ id: string; vesselId: string; location: string; online: boolean; recording: boolean; lastFrame: number }>;
  events?: SecurityEvent[];
  incidents?: Incident[];
};

/** Applies V1.8 FastAPI data while retaining V2-only visual telemetry fixtures. */
export function hydrateFromBackend(payload: BackendPayload) {
  const seeded = buildSeedState();
  if (payload.vessels?.length) {
    const oldIds = seeded.vessels.map((v) => v.id);
    const mapped = payload.vessels.map((v, index) => {
      const visual = seeded.vessels[index % seeded.vessels.length]!;
      const score = v.score;
      const securityState = v.state;
      return { ...visual, ...v, securityScore: score, securityState, lastComms: v.lastComms };
    });
    const remap = new Map(oldIds.map((id, index) => [id, mapped[index % mapped.length]?.id ?? id]));
    state.vessels = mapped;
    state.sensors = seeded.sensors.map((item) => ({ ...item, vesselId: remap.get(item.vesselId) ?? item.vesselId }));
    state.access = seeded.access.map((item) => ({ ...item, vesselId: remap.get(item.vesselId) ?? item.vesselId }));
    state.cyber = seeded.cyber.map((item) => ({ ...item, vesselId: remap.get(item.vesselId) ?? item.vesselId }));
  }
  if (payload.cameras) state.cameras = payload.cameras.map((camera) => ({ id: camera.id, vesselId: camera.vesselId, zone: camera.location, label: `CAM ${camera.location}`, state: camera.online ? "online" : "offline", recording: camera.recording, uptime: camera.online ? 99.9 : 0, fps: camera.online ? 25 : 0, lastFrame: camera.lastFrame }));
  if (payload.events) state.events = payload.events.sort((a, b) => b.ts - a.ts);
  if (payload.incidents) state.incidents = payload.incidents.sort((a, b) => b.updatedAt - a.updatedAt);
  state.connection = { ...state.connection, backend: payload.health === "ok" ? "online" : "degraded", mode: payload.health === "ok" ? "V1.8 ENGINE CONNECTED" : "V1.8 ENGINE UNAVAILABLE" };
  emit();
}

export function selectVessel(id: string | "all") {
  state.selectedVesselId = id;
  emit();
}

export function markNotificationsRead() {
  state.notifications = state.notifications.map((n) => ({ ...n, read: true }));
  emit();
}

export function acknowledgeEvent(id: string) {
  state.events = state.events.map((e) => (e.id === id ? { ...e, acknowledged: true } : e));
  emit();
}

function pushEvent(e: Omit<SecurityEvent, "id" | "ts" | "acknowledged">) {
  const event: SecurityEvent = { ...e, id: uid("evt"), ts: now(), acknowledged: false };
  state.events = [event, ...state.events].slice(0, 400);
  return event;
}

function notify(severity: Severity, title: string, body: string) {
  state.notifications = [
    { id: uid("ntf"), ts: now(), severity, title, body, read: false },
    ...state.notifications,
  ].slice(0, 60);
}

const SEVERITY_WEIGHT: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function scoreDelta(vesselId: string, delta: number) {
  state.vessels = state.vessels.map((v) => {
    if (v.id !== vesselId) return v;
    const securityScore = Math.max(12, Math.min(99, v.securityScore + delta));
    const securityState =
      securityScore >= 86
        ? "secure"
        : securityScore >= 72
          ? "elevated"
          : securityScore >= 55
            ? "warning"
            : "critical";
    return { ...v, securityScore, securityState, lastComms: now() };
  });
}

export function createIncident(input: {
  title: string;
  vesselId: string;
  system: string;
  severity: Severity;
  assignee: string;
  eventIds?: string[];
  origin?: string;
}): Incident {
  const ref = `INC-${2452 + state.incidents.length}`;
  const incident: Incident = {
    id: uid("inc"),
    ref,
    title: input.title,
    vesselId: input.vesselId,
    system: input.system,
    severity: input.severity,
    status: "open",
    assignee: input.assignee,
    openedAt: now(),
    updatedAt: now(),
    eventIds: input.eventIds ?? [],
    notes: [],
    timeline: [
      {
        id: uid("tl"),
        ts: now(),
        text: input.origin ?? "Incident opened manually by operator.",
      },
    ],
  };
  state.incidents = [incident, ...state.incidents];
  notify(
    input.severity,
    `${ref} opened — ${input.severity.toUpperCase()}`,
    `${vesselName(input.vesselId)} — ${input.title}`,
  );
  emit();
  return incident;
}

export function updateIncident(
  id: string,
  patch: Partial<Pick<Incident, "status" | "severity" | "assignee">>,
) {
  state.incidents = state.incidents.map((i) => {
    if (i.id !== id) return i;
    const changes = Object.entries(patch)
      .map(([k, v]) => `${k} → ${String(v)}`)
      .join(", ");
    return {
      ...i,
      ...patch,
      updatedAt: now(),
      timeline: [...i.timeline, { id: uid("tl"), ts: now(), text: `Operator update: ${changes}.` }],
    };
  });
  emit();
}

export function addIncidentNote(id: string, body: string, author: string) {
  state.incidents = state.incidents.map((i) =>
    i.id === id
      ? {
          ...i,
          updatedAt: now(),
          notes: [...i.notes, { id: uid("note"), ts: now(), author, body }],
          timeline: [...i.timeline, { id: uid("tl"), ts: now(), text: "Investigation note added." }],
        }
      : i,
  );
  emit();
}

export function setIncidentStatus(id: string, status: IncidentStatus) {
  updateIncident(id, { status });
}

function vesselName(id: string) {
  return state.vessels.find((v) => v.id === id)?.name ?? id;
}

/* ------------------------------------------------------------------ */
/* Simulation scenarios                                                */
/* ------------------------------------------------------------------ */

export type ScenarioId =
  | "camera-failure"
  | "unauthorized-access"
  | "unknown-device"
  | "brute-force"
  | "suspicious-traffic"
  | "gps-anomaly"
  | "sensor-failure"
  | "firewall-block"
  | "fire-alarm";

export const SCENARIOS: { id: ScenarioId; label: string; group: string; severity: Severity }[] = [
  { id: "camera-failure", label: "Camera failure", group: "CCTV", severity: "medium" },
  { id: "unauthorized-access", label: "Unauthorized access", group: "Access", severity: "high" },
  { id: "unknown-device", label: "Unknown network device", group: "Cyber", severity: "medium" },
  { id: "brute-force", label: "Brute-force login attempt", group: "Cyber", severity: "high" },
  { id: "suspicious-traffic", label: "Suspicious network traffic", group: "Cyber", severity: "high" },
  { id: "gps-anomaly", label: "GPS / AIS anomaly", group: "Navigation", severity: "medium" },
  { id: "sensor-failure", label: "Sensor failure", group: "Sensors", severity: "medium" },
  { id: "firewall-block", label: "Firewall block", group: "Cyber", severity: "low" },
  { id: "fire-alarm", label: "Fire alarm", group: "Sensors", severity: "critical" },
];

/** Rule-based correlation (NOT AI, NOT real threat detection). */
const CORRELATION_RULES: {
  id: string;
  title: string;
  system: string;
  severity: Severity;
  windowMs: number;
  requires: { category: SecurityEvent["category"]; match: string }[];
}[] = [
  {
    id: "rule-intrusion",
    title: "Potential network intrusion — correlated cyber activity",
    system: "OT / IT Network",
    severity: "critical",
    windowMs: 20 * 60 * 1000,
    requires: [
      { category: "cyber", match: "unknown device" },
      { category: "cyber", match: "failed authentication" },
      { category: "cyber", match: "outbound" },
    ],
  },
  {
    id: "rule-physical",
    title: "Possible physical security breach — access plus CCTV loss",
    system: "Access Control / CCTV",
    severity: "high",
    windowMs: 15 * 60 * 1000,
    requires: [
      { category: "access", match: "unauthorized" },
      { category: "camera", match: "offline" },
    ],
  },
  {
    id: "rule-nav",
    title: "Navigation integrity concern — position anomaly with sensor loss",
    system: "GPS / AIS",
    severity: "high",
    windowMs: 15 * 60 * 1000,
    requires: [
      { category: "navigation", match: "anomaly" },
      { category: "sensor", match: "failure" },
    ],
  },
];

function runCorrelation(vesselId: string): string | null {
  const cutoffBase = now();
  for (const rule of CORRELATION_RULES) {
    const window = state.events.filter(
      (e) => e.vesselId === vesselId && cutoffBase - e.ts <= rule.windowMs,
    );
    const matched = rule.requires.map((r) =>
      window.find(
        (e) =>
          e.category === r.category &&
          (e.title + " " + e.detail).toLowerCase().includes(r.match.toLowerCase()),
      ),
    );
    if (matched.every(Boolean)) {
      const already = state.incidents.some(
        (i) =>
          i.vesselId === vesselId &&
          i.title === rule.title &&
          i.status !== "closed" &&
          now() - i.openedAt < rule.windowMs,
      );
      if (already) return null;
      const inc = createIncident({
        title: rule.title,
        vesselId,
        system: rule.system,
        severity: rule.severity,
        assignee: state.operator.name,
        eventIds: matched.map((m) => m!.id),
        origin: `Auto-opened by rule-based correlation (${rule.id}) from ${matched.length} related events.`,
      });
      const cid = inc.id;
      state.events = state.events.map((e) =>
        matched.some((m) => m!.id === e.id) ? { ...e, correlationId: cid } : e,
      );
      scoreDelta(vesselId, rule.severity === "critical" ? -14 : -8);
      return `${inc.ref} auto-opened (${rule.id})`;
    }
  }
  return null;
}

export function triggerScenario(scenario: ScenarioId, vesselId: string) {
  clockOffset += 45_000;
  const vessel = state.vessels.find((v) => v.id === vesselId) ?? state.vessels[0]!;
  const vid = vessel.id;
  let outcome = "Event injected";

  switch (scenario) {
    case "camera-failure": {
      const cam =
        state.cameras.find((c) => c.vesselId === vid && c.state === "online") ??
        state.cameras.find((c) => c.vesselId === vid)!;
      state.cameras = state.cameras.map((c) =>
        c.id === cam.id ? { ...c, state: "offline", recording: false, fps: 0, uptime: 0 } : c,
      );
      pushEvent({
        vesselId: vid,
        category: "camera",
        severity: "medium",
        title: `${cam.label} offline`,
        detail: "Simulated stream loss — camera reported offline by NVR.",
        source: "cctv-nvr",
      });
      scoreDelta(vid, -4);
      outcome = `${cam.label} forced offline`;
      break;
    }
    case "unauthorized-access": {
      state.access = [
        {
          id: uid("acc"),
          ts: now(),
          vesselId: vid,
          credential: `CRD-${1000 + (counter % 9000)}`,
          person: "Unrecognised credential",
          area: "Restricted Store",
          restricted: true,
          result: "suspicious",
        },
        ...state.access,
      ];
      pushEvent({
        vesselId: vid,
        category: "access",
        severity: "high",
        title: "Unauthorized access attempt — restricted area",
        detail: "Simulated unrecognised credential presented at Restricted Store reader.",
        source: "acs-gateway",
      });
      scoreDelta(vid, -6);
      outcome = "Unauthorized access recorded";
      break;
    }
    case "unknown-device": {
      state.cyber = [
        {
          id: uid("cyb"),
          ts: now(),
          vesselId: vid,
          kind: "unknown-device",
          severity: "medium",
          summary: cyberSummary("unknown-device"),
          host: `10.42.${(counter % 9) + 1}.${(counter % 200) + 30}`,
          count: 1,
        },
        ...state.cyber,
      ];
      pushEvent({
        vesselId: vid,
        category: "cyber",
        severity: "medium",
        title: "Unknown device detected on vessel network",
        detail: "Simulated unregistered device joined the crew VLAN.",
        source: "edge-ids",
      });
      scoreDelta(vid, -3);
      outcome = "Unknown device logged";
      break;
    }
    case "brute-force": {
      state.cyber = [
        {
          id: uid("cyb"),
          ts: now(),
          vesselId: vid,
          kind: "failed-auth",
          severity: "high",
          summary: "Multiple failed authentication attempts against edge console",
          host: `10.42.${(counter % 9) + 1}.${(counter % 200) + 30}`,
          count: 48,
        },
        ...state.cyber,
      ];
      pushEvent({
        vesselId: vid,
        category: "cyber",
        severity: "high",
        title: "Multiple failed authentication attempts",
        detail: "Simulated repeated failed authentication (48 attempts) against edge console.",
        source: "edge-auth",
      });
      scoreDelta(vid, -5);
      outcome = "Failed authentication burst logged";
      break;
    }
    case "suspicious-traffic": {
      state.cyber = [
        {
          id: uid("cyb"),
          ts: now(),
          vesselId: vid,
          kind: "suspicious-traffic",
          severity: "high",
          summary: cyberSummary("suspicious-traffic"),
          host: `10.42.${(counter % 9) + 1}.${(counter % 200) + 30}`,
          count: 6,
        },
        ...state.cyber,
      ];
      pushEvent({
        vesselId: vid,
        category: "cyber",
        severity: "high",
        title: "Suspicious outbound traffic observed",
        detail: "Simulated sustained outbound session to an unclassified endpoint.",
        source: "edge-firewall",
      });
      scoreDelta(vid, -6);
      outcome = "Suspicious traffic logged";
      break;
    }
    case "gps-anomaly": {
      state.vessels = state.vessels.map((v) =>
        v.id === vid ? { ...v, gpsAis: "degraded" } : v,
      );
      pushEvent({
        vesselId: vid,
        category: "navigation",
        severity: "medium",
        title: "GPS position anomaly detected",
        detail: "Simulated position jump of 2.4 nm with AIS/GPS divergence.",
        source: "nav-bridge",
      });
      scoreDelta(vid, -5);
      outcome = "GPS/AIS marked degraded";
      break;
    }
    case "sensor-failure": {
      const sensor =
        state.sensors.find((s) => s.vesselId === vid && s.state === "online") ??
        state.sensors.find((s) => s.vesselId === vid)!;
      state.sensors = state.sensors.map((s) =>
        s.id === sensor.id ? { ...s, state: "offline", reading: "No data", uptime: 0 } : s,
      );
      pushEvent({
        vesselId: vid,
        category: "sensor",
        severity: "medium",
        title: `Sensor failure — ${sensor.kind} (${sensor.location})`,
        detail: "Simulated sensor stopped reporting on the vessel sensor bus.",
        source: "sensor-bus",
      });
      scoreDelta(vid, -4);
      outcome = `${sensor.kind} sensor offline`;
      break;
    }
    case "firewall-block": {
      state.cyber = [
        {
          id: uid("cyb"),
          ts: now(),
          vesselId: vid,
          kind: "firewall-block",
          severity: "low",
          summary: cyberSummary("firewall-block"),
          host: `10.42.${(counter % 9) + 1}.${(counter % 200) + 30}`,
          count: 1,
        },
        ...state.cyber,
      ];
      pushEvent({
        vesselId: vid,
        category: "cyber",
        severity: "low",
        title: "Firewall blocked egress attempt",
        detail: "Simulated egress rule blocked a non-whitelisted destination.",
        source: "edge-firewall",
      });
      outcome = "Firewall block logged";
      break;
    }
    case "fire-alarm": {
      const sensor =
        state.sensors.find((s) => s.vesselId === vid && s.kind === "fire") ??
        state.sensors.find((s) => s.vesselId === vid)!;
      state.sensors = state.sensors.map((s) =>
        s.id === sensor.id ? { ...s, alarm: true, reading: "FLAME DETECTED" } : s,
      );
      const evt = pushEvent({
        vesselId: vid,
        category: "sensor",
        severity: "critical",
        title: `Fire alarm — ${sensor.location}`,
        detail: "Simulated fire detection alarm asserted on the vessel sensor bus.",
        source: "sensor-bus",
      });
      createIncident({
        title: `Fire alarm asserted — ${sensor.location}`,
        vesselId: vid,
        system: "Sensors / Safety",
        severity: "critical",
        assignee: state.operator.name,
        eventIds: [evt.id],
        origin: "Auto-opened: critical sensor alarm policy (simulated).",
      });
      scoreDelta(vid, -18);
      outcome = "Fire alarm + critical incident";
      break;
    }
  }

  const correlated = runCorrelation(vid);
  if (correlated) outcome += ` · ${correlated}`;
  else {
    const sev = SCENARIOS.find((s) => s.id === scenario)!.severity;
    if (SEVERITY_WEIGHT[sev] >= 3) {
      notify(sev, `${sev.toUpperCase()} event — ${vessel.name}`, outcome);
    }
  }

  state.simLog = [
    {
      id: uid("sim"),
      ts: now(),
      scenario: SCENARIOS.find((s) => s.id === scenario)!.label,
      vesselId: vid,
      outcome,
    },
    ...state.simLog,
  ].slice(0, 40);

  emit();
  return outcome;
}

export function resetSimulation() {
  state = buildSeedState();
  clockOffset = 0;
  emit();
}

/** Ambient telemetry tick — keeps the console looking live. */
export function tick() {
  clockOffset += 2000;
  state.cameras = state.cameras.map((c) =>
    c.state === "online" ? { ...c, lastFrame: now(), fps: 24 + ((counter + c.uptime) % 3) } : c,
  );
  state.vessels = state.vessels.map((v) => ({ ...v, lastComms: v.lastComms }));
  state.sensors = state.sensors.map((s) =>
    s.state === "online" && s.kind === "temperature" && !s.alarm
      ? { ...s, reading: `${(19 + ((counter * 7) % 110) / 10).toFixed(1)} °C` }
      : s,
  );
  counter += 1;
  emit();
}
