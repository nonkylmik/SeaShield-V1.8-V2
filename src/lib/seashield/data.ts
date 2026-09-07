import type {
  AccessRecord,
  Camera,
  CyberFinding,
  Incident,
  SeaShieldState,
  SecurityEvent,
  Sensor,
  SensorKind,
  Vessel,
} from "./types";

/**
 * Deterministic simulated seed data (Prototype V1).
 * A fixed epoch + seeded PRNG keeps server and client renders identical.
 * NOTE: every value here is fictional and simulated. No real vessel,
 * camera, network or security infrastructure is involved.
 */
export const SIM_EPOCH = 1_772_000_000_000; // fixed reference instant

let seed = 20260903;
function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)]!;
}
function int(min: number, max: number) {
  return Math.floor(min + rnd() * (max - min + 1));
}

export const CAMERA_ZONES = [
  "Bridge",
  "Main Deck",
  "Cargo Area",
  "Engine Room",
  "Port Side",
  "Starboard Side",
  "Stern",
  "Entrance",
] as const;

export const SENSOR_KINDS: SensorKind[] = [
  "fire",
  "smoke",
  "temperature",
  "water",
  "motion",
  "door",
  "bilge",
];

const SENSOR_LOCATIONS: Record<SensorKind, string[]> = {
  fire: ["Engine Room", "Galley", "Cargo Hold 2"],
  smoke: ["Accommodation Deck", "Engine Control Room"],
  temperature: ["Reefer Bay A", "Engine Room", "Cargo Hold 1"],
  water: ["Forward Peak", "Cargo Hold 3"],
  motion: ["Stern Deck", "Restricted Store", "Bridge Wing"],
  door: ["Bridge Access", "Engine Room Door", "Citadel Hatch"],
  bilge: ["Bilge Well Port", "Bilge Well Stbd"],
};

const VESSEL_SEED: Array<
  Pick<Vessel, "name" | "imo" | "type" | "flag" | "route" | "position"> & {
    state: Vessel["securityState"];
  }
> = [
  {
    name: "MV Northern Meridian",
    imo: "IMO 9481207",
    type: "Container 8,400 TEU",
    flag: "Panama",
    route: "Rotterdam → Algeciras",
    position: "48°12′N 005°41′W",
    state: "secure",
  },
  {
    name: "MV Arctic Vanguard",
    imo: "IMO 9522118",
    type: "Bulk Carrier",
    flag: "Liberia",
    route: "Narvik → Bremerhaven",
    position: "58°44′N 004°02′E",
    state: "elevated",
  },
  {
    name: "MV Coral Dominion",
    imo: "IMO 9613440",
    type: "Container 4,200 TEU",
    flag: "Marshall Islands",
    route: "Suez → Jebel Ali",
    position: "27°18′N 034°02′E",
    state: "warning",
  },
  {
    name: "MV Baltic Sentinel",
    imo: "IMO 9377502",
    type: "Ro-Ro Cargo",
    flag: "Malta",
    route: "Gdańsk → Helsinki",
    position: "55°51′N 018°23′E",
    state: "secure",
  },
  {
    name: "MV Pacific Ledger",
    imo: "IMO 9705661",
    type: "Container 11,000 TEU",
    flag: "Singapore",
    route: "Singapore → Yokohama",
    position: "12°04′N 114°37′E",
    state: "secure",
  },
  {
    name: "MV Atlantic Custodian",
    imo: "IMO 9288417",
    type: "General Cargo",
    flag: "Cyprus",
    route: "Santos → Houston",
    position: "09°22′S 034°55′W",
    state: "elevated",
  },
  {
    name: "MV Iron Kestrel",
    imo: "IMO 9445823",
    type: "Bulk Carrier",
    flag: "Bahamas",
    route: "Port Hedland → Qingdao",
    position: "18°55′S 118°12′E",
    state: "secure",
  },
  {
    name: "MV Southern Ledger",
    imo: "IMO 9812004",
    type: "Chemical Tanker",
    flag: "Norway",
    route: "Ras Tanura → Mumbai",
    position: "24°10′N 057°44′E",
    state: "critical",
  },
];

const OPERATORS = [
  "K. Halvorsen",
  "M. Okonjo",
  "D. Reyes",
  "S. Lindqvist",
  "A. Nasser",
];

function stateScore(state: Vessel["securityState"]) {
  return state === "secure"
    ? int(88, 97)
    : state === "elevated"
      ? int(74, 85)
      : state === "warning"
        ? int(58, 71)
        : int(34, 52);
}

function degrade(state: Vessel["securityState"]): Vessel["network"] {
  return state === "critical" ? "degraded" : state === "warning" ? "degraded" : "online";
}

export function buildSeedState(): SeaShieldState {
  seed = 20260903;

  const vessels: Vessel[] = VESSEL_SEED.map((v, i) => ({
    id: `vsl-${String(i + 1).padStart(2, "0")}`,
    name: v.name,
    imo: v.imo,
    type: v.type,
    flag: v.flag,
    route: v.route,
    position: v.position,
    lastComms: SIM_EPOCH - int(20, 900) * 1000,
    securityState: v.state,
    securityScore: stateScore(v.state),
    physical: v.state === "critical" ? "warning" : v.state,
    cyber: v.state === "warning" ? "warning" : v.state === "critical" ? "critical" : v.state,
    network: degrade(v.state),
    gpsAis: v.state === "critical" ? "degraded" : "online",
    accessControl: "online",
    crew: int(18, 26),
  }));

  const cameras: Camera[] = [];
  vessels.forEach((v) => {
    CAMERA_ZONES.forEach((zone, zi) => {
      const broken = v.securityState === "critical" && zi === 3;
      const degraded = v.securityState === "warning" && zi === 6;
      cameras.push({
        id: `${v.id}-cam-${zi + 1}`,
        vesselId: v.id,
        zone,
        label: `CAM-${String(zi + 1).padStart(2, "0")} ${zone}`,
        state: broken ? "offline" : degraded ? "degraded" : "online",
        recording: !broken,
        uptime: broken ? 0 : degraded ? 91.4 : 99.1 + rnd() * 0.85,
        fps: broken ? 0 : degraded ? 9 : 25,
        lastFrame: SIM_EPOCH - (broken ? int(400, 900) * 1000 : int(0, 3) * 1000),
      });
    });
  });

  const sensors: Sensor[] = [];
  vessels.forEach((v) => {
    SENSOR_KINDS.forEach((kind, ki) => {
      SENSOR_LOCATIONS[kind].slice(0, kind === "motion" ? 2 : 1).forEach((loc, li) => {
        const offline = v.securityState === "critical" && kind === "water";
        sensors.push({
          id: `${v.id}-sen-${ki}${li}`,
          vesselId: v.id,
          kind,
          location: loc,
          state: offline ? "offline" : "online",
          reading: sensorReading(kind),
          alarm: false,
          uptime: offline ? 0 : 98 + rnd() * 1.9,
        });
      });
    });
  });

  const cyber: CyberFinding[] = [];
  const cyberKinds: CyberFinding["kind"][] = [
    "unknown-device",
    "failed-auth",
    "suspicious-traffic",
    "firewall-block",
    "anomaly",
  ];
  vessels.forEach((v) => {
    const n = v.cyber === "secure" ? 2 : v.cyber === "elevated" ? 3 : 5;
    for (let i = 0; i < n; i++) {
      const kind = cyberKinds[i % cyberKinds.length]!;
      cyber.push({
        id: `${v.id}-cyb-${i}`,
        ts: SIM_EPOCH - int(120, 60_000) * 1000,
        vesselId: v.id,
        kind,
        severity:
          kind === "suspicious-traffic"
            ? "high"
            : kind === "unknown-device"
              ? "medium"
              : kind === "failed-auth"
                ? "medium"
                : "low",
        summary: cyberSummary(kind),
        host: `10.42.${int(1, 9)}.${int(20, 240)}`,
        count: kind === "failed-auth" ? int(9, 64) : int(1, 12),
      });
    }
  });

  const access: AccessRecord[] = [];
  const areas = [
    "Bridge",
    "Engine Room",
    "Cargo Control Room",
    "Restricted Store",
    "Citadel",
    "Accommodation",
  ];
  vessels.forEach((v) => {
    for (let i = 0; i < 6; i++) {
      const result: AccessRecord["result"] =
        i === 0 && v.securityState !== "secure"
          ? "denied"
          : i === 1 && v.securityState === "critical"
            ? "suspicious"
            : "authorized";
      const area = pick(areas);
      access.push({
        id: `${v.id}-acc-${i}`,
        ts: SIM_EPOCH - int(60, 40_000) * 1000,
        vesselId: v.id,
        credential: `CRD-${int(1000, 9999)}`,
        person: result === "authorized" ? pick(OPERATORS) : "Unrecognised credential",
        area,
        restricted: ["Bridge", "Engine Room", "Restricted Store", "Citadel"].includes(area),
        result,
      });
    }
  });

  const events: SecurityEvent[] = [];
  vessels.forEach((v) => {
    const n = v.securityState === "secure" ? 3 : 6;
    for (let i = 0; i < n; i++) {
      const t = pick(BASE_EVENTS);
      events.push({
        id: `${v.id}-evt-${i}`,
        ts: SIM_EPOCH - int(30, 50_000) * 1000,
        vesselId: v.id,
        category: t.category,
        severity: t.severity,
        title: t.title,
        detail: t.detail,
        source: t.source,
        acknowledged: rnd() > 0.55,
      });
    }
  });
  events.sort((a, b) => b.ts - a.ts);

  const incidents: Incident[] = [
    makeIncident(
      "INC-2451",
      "Possible network intrusion — engine control VLAN",
      "vsl-08",
      "OT Network",
      "critical",
      "investigating",
      "K. Halvorsen",
      1800,
    ),
    makeIncident(
      "INC-2448",
      "Repeated denied access at restricted store",
      "vsl-03",
      "Access Control",
      "high",
      "open",
      "M. Okonjo",
      9400,
    ),
    makeIncident(
      "INC-2440",
      "Stern camera degraded — frame loss",
      "vsl-03",
      "CCTV",
      "medium",
      "contained",
      "D. Reyes",
      42_000,
    ),
    makeIncident(
      "INC-2431",
      "AIS position discontinuity during transit",
      "vsl-06",
      "GPS / AIS",
      "medium",
      "closed",
      "S. Lindqvist",
      120_000,
    ),
  ];

  return {
    vessels,
    cameras,
    sensors,
    events,
    access,
    cyber,
    incidents,
    notifications: [
      {
        id: "ntf-1",
        ts: SIM_EPOCH - 1800_000,
        severity: "critical",
        title: "INC-2451 escalated",
        body: "MV Southern Ledger — correlated cyber activity on engine control VLAN.",
        read: false,
      },
      {
        id: "ntf-2",
        ts: SIM_EPOCH - 9400_000,
        severity: "high",
        title: "Access denied ×3",
        body: "MV Coral Dominion — restricted store, unrecognised credential.",
        read: false,
      },
      {
        id: "ntf-3",
        ts: SIM_EPOCH - 42_000_000,
        severity: "medium",
        title: "Camera degraded",
        body: "MV Coral Dominion — CAM-07 Stern frame loss above threshold.",
        read: true,
      },
    ],
    simLog: [],
    selectedVesselId: "all",
    operator: { name: "R. Vance", role: "Senior Security Operator", shift: "12:00–00:00Z" },
    connection: { edge: "online", backend: "online", mode: "SIMULATION V1" },
  };
}

function makeIncident(
  ref: string,
  title: string,
  vesselId: string,
  system: string,
  severity: Incident["severity"],
  status: Incident["status"],
  assignee: string,
  agoSec: number,
): Incident {
  const openedAt = SIM_EPOCH - agoSec * 1000;
  return {
    id: ref.toLowerCase(),
    ref,
    title,
    vesselId,
    system,
    severity,
    status,
    assignee,
    openedAt,
    updatedAt: openedAt + 600_000,
    eventIds: [],
    notes: [
      {
        id: `${ref}-n1`,
        ts: openedAt + 240_000,
        author: assignee,
        body: "Simulated investigation note: correlated events reviewed, vessel master notified via routine channel.",
      },
    ],
    timeline: [
      { id: `${ref}-t1`, ts: openedAt, text: `Incident opened from correlated events (${system}).` },
      { id: `${ref}-t2`, ts: openedAt + 300_000, text: `Assigned to ${assignee}.` },
      { id: `${ref}-t3`, ts: openedAt + 600_000, text: `Status set to ${status}.` },
    ],
  };
}

const BASE_EVENTS: Array<{
  category: SecurityEvent["category"];
  severity: SecurityEvent["severity"];
  title: string;
  detail: string;
  source: string;
}> = [
  {
    category: "cyber",
    severity: "medium",
    title: "Unknown device on crew VLAN",
    detail: "Unregistered MAC observed on switch port 14 (simulated).",
    source: "edge-ids",
  },
  {
    category: "access",
    severity: "low",
    title: "Bridge access granted",
    detail: "Credential validated at bridge door reader (simulated).",
    source: "acs-gateway",
  },
  {
    category: "sensor",
    severity: "info",
    title: "Bilge level nominal",
    detail: "Routine bilge telemetry within threshold (simulated).",
    source: "sensor-bus",
  },
  {
    category: "camera",
    severity: "low",
    title: "Camera stream reconnected",
    detail: "CAM-05 Port Side re-established after link flap (simulated).",
    source: "cctv-nvr",
  },
  {
    category: "navigation",
    severity: "medium",
    title: "AIS transmit gap",
    detail: "AIS broadcast gap of 94s recorded (simulated).",
    source: "nav-bridge",
  },
  {
    category: "cyber",
    severity: "high",
    title: "Suspicious outbound traffic",
    detail: "Sustained outbound session to unclassified endpoint (simulated).",
    source: "edge-firewall",
  },
  {
    category: "system",
    severity: "info",
    title: "Edge server heartbeat",
    detail: "Vessel edge node reported healthy (simulated).",
    source: "edge-agent",
  },
];

export function sensorReading(kind: SensorKind): string {
  switch (kind) {
    case "fire":
      return "No flame";
    case "smoke":
      return `${(0.02 + rnd() * 0.03).toFixed(3)} obs/m`;
    case "temperature":
      return `${(18 + rnd() * 14).toFixed(1)} °C`;
    case "water":
      return "Dry";
    case "motion":
      return "No motion";
    case "door":
      return "Closed / secured";
    case "bilge":
      return `${(3 + rnd() * 9).toFixed(0)} mm`;
  }
}

export function cyberSummary(kind: CyberFinding["kind"]): string {
  switch (kind) {
    case "unknown-device":
      return "Unregistered device joined vessel network segment";
    case "failed-auth":
      return "Repeated failed authentication against edge console";
    case "suspicious-traffic":
      return "Outbound session to unclassified endpoint";
    case "firewall-block":
      return "Egress rule blocked non-whitelisted destination";
    case "anomaly":
      return "Traffic volume deviates from baseline profile";
  }
}
