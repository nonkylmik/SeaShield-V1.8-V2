export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type SecurityState = "secure" | "elevated" | "warning" | "critical";

export type OnlineState = "online" | "degraded" | "offline";

export type EventCategory =
  | "cyber"
  | "access"
  | "sensor"
  | "camera"
  | "navigation"
  | "system";

export interface SecurityEvent {
  id: string;
  ts: number;
  vesselId: string;
  category: EventCategory;
  severity: Severity;
  title: string;
  detail: string;
  source: string;
  acknowledged: boolean;
  correlationId?: string;
}

export interface Camera {
  id: string;
  vesselId: string;
  zone: string;
  label: string;
  state: OnlineState;
  recording: boolean;
  uptime: number;
  fps: number;
  lastFrame: number;
}

export type SensorKind =
  | "fire"
  | "smoke"
  | "temperature"
  | "water"
  | "motion"
  | "door"
  | "bilge";

export interface Sensor {
  id: string;
  vesselId: string;
  kind: SensorKind;
  location: string;
  state: OnlineState;
  reading: string;
  alarm: boolean;
  uptime: number;
}

export interface AccessRecord {
  id: string;
  ts: number;
  vesselId: string;
  credential: string;
  person: string;
  area: string;
  restricted: boolean;
  result: "authorized" | "denied" | "suspicious";
}

export interface CyberFinding {
  id: string;
  ts: number;
  vesselId: string;
  kind:
    | "unknown-device"
    | "failed-auth"
    | "suspicious-traffic"
    | "firewall-block"
    | "anomaly";
  severity: Severity;
  summary: string;
  host: string;
  count: number;
}

export interface Vessel {
  id: string;
  name: string;
  imo: string;
  type: string;
  flag: string;
  route: string;
  position: string;
  lastComms: number;
  securityState: SecurityState;
  securityScore: number;
  physical: SecurityState;
  cyber: SecurityState;
  network: OnlineState;
  gpsAis: OnlineState;
  accessControl: OnlineState;
  crew: number;
}

export type IncidentStatus = "open" | "investigating" | "contained" | "closed";

export interface IncidentNote {
  id: string;
  ts: number;
  author: string;
  body: string;
}

export interface Incident {
  id: string;
  ref: string;
  title: string;
  vesselId: string;
  system: string;
  severity: Severity;
  status: IncidentStatus;
  assignee: string;
  openedAt: number;
  updatedAt: number;
  eventIds: string[];
  notes: IncidentNote[];
  timeline: { id: string; ts: number; text: string }[];
}

export interface SimulationLogEntry {
  id: string;
  ts: number;
  scenario: string;
  vesselId: string;
  outcome: string;
}

export interface Notification {
  id: string;
  ts: number;
  severity: Severity;
  title: string;
  body: string;
  read: boolean;
}

export interface SeaShieldState {
  vessels: Vessel[];
  cameras: Camera[];
  sensors: Sensor[];
  events: SecurityEvent[];
  access: AccessRecord[];
  cyber: CyberFinding[];
  incidents: Incident[];
  notifications: Notification[];
  simLog: SimulationLogEntry[];
  selectedVesselId: string | "all";
  operator: { name: string; role: string; shift: string };
  connection: { edge: OnlineState; backend: OnlineState; mode: string };
}
