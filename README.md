# SeaShield — Maritime Security Operations Prototype

SeaShield is a prototype security operations interface for commercial cargo vessels and shipping companies. It combines physical security, cybersecurity, incident management, safety rounds and fleet monitoring in a single operator-facing application.

> **Prototype status:** SeaShield is **simulation-only**. All vessels, cameras, sensors, network activity, security events and telemetry are fictional. It does not connect to real vessels, CCTV, sensors, networks or maritime infrastructure, and it is not production-ready.

The repository contains a Python/FastAPI backend (API version `1.9.0`) and a React/TypeScript frontend (the "V2" interface), with the V3 foundation work described below. The frontend is a desktop-oriented web interface that runs in the browser; it is not packaged as a native desktop application.

---

## Contents

- [Implemented features](#implemented-features)
- [Architecture and technology stack](#architecture-and-technology-stack)
- [Frontend/backend integration](#frontendbackend-integration)
- [Security simulation and event correlation](#security-simulation-and-event-correlation)
- [Database and persistence](#database-and-persistence)
- [V3 foundation improvements](#v3-foundation-improvements)
- [Development setup](#development-setup)
- [Testing and validation](#testing-and-validation)
- [Project structure](#project-structure)
- [Limitations and unverified areas](#limitations-and-unverified-areas)
- [Future development (planned)](#future-development-planned)
- [License](#license)

---

## Implemented features

The frontend provides these views (TanStack file routes in `src/routes/`):

| View | Route | Data source |
|---|---|---|
| Dashboard | `/` | Backend data merged with visual fixtures |
| Fleet overview | `/fleet` | Backend vessels |
| Vessels and vessel detail | `/vessels`, `/vessels/$vesselId` | Backend vessels, events, incidents, safety data; sensor/access/cyber panels from fixtures |
| CCTV monitoring (simulated feeds) | `/cameras` | Backend camera records; no real video |
| Incidents (notes, status, assignment, related events) | `/incidents` | Backend |
| Safety rounds (templates, checkpoints, findings) | `/safety-rounds` | Backend |
| Security reporting | `/reports` | Current simulated session and persisted safety rounds |
| Sensors | `/sensors` | Frontend fixtures |
| Access control | `/access-control` | Frontend fixtures |
| Cybersecurity | `/cybersecurity` | Frontend fixtures |
| Settings and connection status | `/settings` | Backend health |

Sensor, access-control and cybersecurity-alert telemetry are frontend fixtures (`src/lib/seashield/data.ts`) because the backend has no equivalent endpoints yet. Cyber-category security events from the backend still appear in the event and incident views.

Backend capabilities:

- **Simulation engine** with four deterministic scenarios and manual event injection.
- **Rule-based event correlation** that turns related events into incidents.
- **Risk scoring**: a bounded 0–100 security score per vessel.
- **Incident workflow**: create, update, notes, activity history, event acknowledgement.
- **Safety rounds**: templates, round lifecycle (start, complete, cancel), checkpoint results and findings, with failed checkpoints creating security events. Resolving or dismissing a finding resolves its events, so it no longer lowers the vessel's score, and records a `SAFETY_FINDING_RESOLVED` or `SAFETY_FINDING_DISMISSED` event; a checkpoint that fails again afterwards opens a new finding.
- **WebSocket broadcasts** of state changes to connected clients.
- **Optional authentication**: a single demo user with an HMAC-signed session cookie, off by default (`AUTH_REQUIRED`).
- **Persistent storage** through SQLAlchemy and Alembic (SQLite by default).

---

## Architecture and technology stack

```text
          React / TypeScript frontend (V2)
     TanStack Start + Router · Tailwind CSS
   src/lib/seashield/backend.ts (REST + WebSocket)
                       │
                       │  HTTP (JSON)  /  WebSocket /ws/security
                       ▼
             FastAPI backend (backend/app/main.py)
                       │
     ┌─────────────────┼──────────────────┐
     ▼                 ▼                  ▼
 Simulation       Security engine     Persistence
 engine           (correlation,       SQLAlchemy 2 + Alembic
 (scenarios,      risk scoring,       SQLite (default)
 event library)   incidents)
```

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript (strict), TanStack Start / Router / Query, Tailwind CSS 4, shadcn/ui components |
| Frontend build | Vite 8 with an explicit `vite.config.ts`; `npm run build` produces a Nitro server build (Cloudflare module preset) in `.output/` |
| Backend | Python, FastAPI, Uvicorn, Pydantic v2, WebSockets |
| Persistence | SQLAlchemy 2, Alembic migrations, SQLite (default) |
| Testing | `node --test` (+ `jsdom`) for frontend units; pytest for the backend |
| Tooling | npm (`package-lock.json`), ESLint + Prettier, Docker Compose (optional backend dev environment) |

---

## Frontend/backend integration

The UI reaches the backend only through `src/lib/seashield/services.ts` and `src/lib/seashield/backend.ts`.

- **Base URL:** `VITE_API_URL`, defaulting to `http://localhost:8000`. It is read at build time (`import.meta.env`), so changing it requires restarting `npm run dev` or rebuilding.
- **REST:** the client loads vessels, cameras, security events, incidents, safety rounds and findings from `/api/v1/...` and `/api/security-events`, and calls `/health` to show the backend status.
- **WebSocket:** the client connects to `/ws/security` on the same host as `VITE_API_URL`, and the scheme follows that URL: `http://` becomes `ws://`, and `https://` becomes `wss://`. With the default `http://localhost:8000`, the connection is unencrypted (`ws://localhost:8000/ws/security`). The scheme comes from `VITE_API_URL`, not the page's own protocol. The backend does not terminate TLS itself: Uvicorn serves plain HTTP and WebSocket. A `wss://` connection would therefore need a TLS-terminating proxy in front of the backend, which this project does not include. Any message from the server triggers a debounced refresh of backend data. If the connection drops, the UI marks the backend as degraded and reconnects with exponential backoff.
- **Server messages** include `security_event`, `security_event_created`, `security_event_deleted`, `incident_created`, `incident_updated`, `security_score_changed`, `vessel_status_changed`, `simulation_status`, `notification`, `event_acknowledged` and the `safety_round_*` / `safety_checkpoint_updated` / `safety_finding_*` types.
- **CORS:** the backend allows `http(s)://localhost` and `http(s)://127.0.0.1` origins on any port, with credentials.

Many routes exist under both a legacy path (e.g. `/vessels`, `/simulation/tick`) and `/api/v1/...`. The interactive API reference is at `http://localhost:8000/docs` while the backend runs.

---

## Security simulation and event correlation

All events are fictional labels. For example, `FAILED_AUTHENTICATION` does not attempt authentication, and `UNKNOWN_DEVICE` does not scan a network.

**Event library** (`backend/simulation/event_generator.py`):

| Category | Event types |
|---|---|
| Cyber | `UNKNOWN_DEVICE`, `FAILED_AUTHENTICATION`, `SUSPICIOUS_TRAFFIC`, `FIREWALL_BLOCK` |
| Physical | `UNAUTHORIZED_ACCESS`, `CAMERA_OFFLINE`, `SENSOR_FAILURE` |
| Vessel | `GPS_ANOMALY`, `AIS_ANOMALY`, `COMMUNICATION_INSTABILITY` |
| Environmental | `SMOKE_DETECTED`, `FIRE_ALARM`, `TEMPERATURE_HIGH` |

**Scenarios** (`backend/simulation/scenario_manager.py`), stepped with `POST /api/v1/simulation/next`:
`cyber-intrusion`, `physical-breach`, `navigation-anomaly`, `fire-emergency`.

**Manual injection:** the simulation console in the UI triggers single events through `POST /api/v1/simulation/inject`.

**Correlation rules** (`backend/security_engine/event_correlation.py`). Each new event is checked against the rules that include its type. A rule matches when every one of its event types is present among the vessel's **unresolved** events. A match creates an incident, unless an open incident from the same rule already exists for that vessel, in which case the matching events are added to it:

| Rule | Required events | Severity |
|---|---|---|
| Potential Network Intrusion | `UNKNOWN_DEVICE`, `FAILED_AUTHENTICATION`, `SUSPICIOUS_TRAFFIC` | Critical |
| Potential Physical Security Breach | `UNAUTHORIZED_ACCESS`, `CAMERA_OFFLINE` | High |
| Navigation/Communication Anomaly | `GPS_ANOMALY`, `AIS_ANOMALY`, `COMMUNICATION_INSTABILITY` | High |
| Fire/Environmental Emergency | `SMOKE_DETECTED`, `FIRE_ALARM`, `TEMPERATURE_HIGH` | Critical |

**Risk scoring** (`backend/security_engine/risk_scoring.py`): score = vessel base score − penalties for its unresolved events − penalties for its open incidents (anything not `RESOLVED` or `FALSE_POSITIVE`), clamped to 0–100.

| Severity | Info | Low | Medium | High | Critical |
|---|---|---|---|---|---|
| Event penalty | 0 | 2 | 5 | 10 | 20 |
| Incident penalty | 0 | 4 | 8 | 15 | 25 |

Vessel security status is classified by the backend only (`backend/models/security_status.py`), from the score: `SECURE` 86–100, `ELEVATED` 72–85, `WARNING` 55–71, `CRITICAL` 0–54. Every API response and WebSocket message derives the status from the score, so a stale or missing stored value is never returned. The UI shows the status it receives and never classifies scores; a missing or unrecognised status is shown as unknown. Fleet status is the most severe vessel status (critical, then unknown, warning, elevated, secure). Severity (info–critical) classifies individual events, incidents and safety findings and affects a vessel's status only through these penalties.

Example flow (cyber intrusion scenario):

```text
UNKNOWN_DEVICE → FAILED_AUTHENTICATION → SUSPICIOUS_TRAFFIC
        → rule "Potential Network Intrusion" matches
        → critical incident created (or updated, if one is already open), vessel score reduced
        → WebSocket broadcast → UI refreshes
```

---

## Database and persistence

- **SQLite is the current default and the only database the project has been run against.** Without `DATABASE_URL`, the backend uses `backend/seashield.db`.
- **SQLAlchemy 2** models live in `backend/db/models.py`, with data access through repositories in `backend/db/repositories/`.
- **Alembic** migrations live in `backend/alembic/versions/` (`0001`–`0005`). `alembic/env.py` uses the same `DATABASE_URL` as the application.
- **On startup** the application also runs `Base.metadata.create_all`, seeds demo safety-round data and re-syncs the in-memory simulation engine from the database.
- **Configuration:** `DATABASE_URL` is read from the environment or a root `.env` file. `.env` files and `*.db` files are gitignored.
- **PostgreSQL:** support exists in code (the `psycopg` driver in `requirements.txt` and `JSONB` column variants), but it **has not been verified against a running PostgreSQL server**.

**Persistence by workflow:**

| Workflow | Database location | Lifetime |
|---|---|---|
| Host backend | `backend/seashield.db` (or `DATABASE_URL`) | Until the file is deleted |
| Docker Compose | `/data/seashield.db` in the named volume `seashield-data` | Survives `docker compose down` and rebuilds; deleted by `docker compose down -v` |
| Backend tests | Throwaway `backend/seashield_test.db` and temporary files | Removed after the test run |

The host and Docker databases are separate.

---

## V3 foundation improvements

- **`/cameras` hydration fix:** server HTML (seed data) and the first client render no longer disagree when backend data arrives before the route hydrates. Covered by a `jsdom` regression test (`src/lib/seashield/hydration.test.mjs`).
- **Vessel detail render loop fixed** with a cached selector (`src/lib/seashield/cachedSelector.ts`), with unit tests.
- **Vessel detail on direct load or reload** shows a loading state until backend data arrives, instead of a premature "not found" (`src/lib/seashield/vesselView.ts`), with unit tests.
- **Docker development backend:** `backend/Dockerfile`, `backend/.dockerignore` and `compose.yaml` (see [setup](#option-b-docker-compose)).
- **Stable dev port:** the Vite dev server is pinned to `127.0.0.1:8080` with a strict port. A `predev` check (`scripts/assert-dev-port.mjs`) fails fast if the port is taken, instead of silently switching ports.
- **Lovable independence:** the Lovable-specific Vite wrapper (`@lovable.dev/vite-tanstack-config`) was replaced by an explicit `vite.config.ts`, and Lovable-only files were removed.
- **Supported Node.js range** declared in `package.json` `engines`, with `.nvmrc` and a synced lockfile.
- **Documentation:** database status corrected (SQLite current, PostgreSQL unverified); contributor guidance in `CLAUDE.md` and `AGENTS.md`; proprietary `LICENSE`.

---

## Development setup

### Prerequisites

- **Node.js** `^22.22.2 || ^24.15.0 || >=26.0.0` (from `package.json` `engines`; `.nvmrc` selects 24) and **npm**. `package-lock.json` is the only lockfile.
- **Python** 3.12 or newer for the host backend. 3.12 is the provisional minimum and is not yet declared in config.
- **Docker** with Compose (optional, for the Docker backend).

### 1. Backend

Run either the host backend or the Docker backend. Both use port 8000, so only one can run at a time.

#### Option A: Host (Python virtual environment)

From the `backend/` directory:

```bash
python -m venv .venv
# Windows (PowerShell):  .\.venv\Scripts\Activate.ps1
# Linux/macOS:           source .venv/bin/activate
python -m pip install -r requirements.txt
python -m alembic upgrade head
python -m uvicorn app.main:app --reload --port 8000
```

- Run `alembic upgrade head` before the first start, so the database is migration-tracked.
- Uvicorn listens on `http://127.0.0.1:8000`.
- `backend/.venv/` is gitignored.

#### Existing databases created without migrations

The backend's startup code creates any missing tables (`Base.metadata.create_all`) but does not record an Alembic version. A database created by starting the backend before ever running `alembic upgrade head` is therefore unversioned. Earlier versions of this README gave exactly that sequence. On such a database, `alembic upgrade head` fails at the first migration with `table security_events already exists`. No data is lost, but the database stays unversioned.

The recovery procedure below applies **only** to a database that was created by the **current** startup code and whose schema you have verified against a database built by `alembic upgrade head`:

1. **Back up first.** Stop the backend and copy the database file (for example `backend/seashield.db`) somewhere safe before stamping or migrating.
2. **Verify the schema.** Compare it with a reference database created by `alembic upgrade head` on a fresh, empty file (set `DATABASE_URL` to a scratch path). Matching table and column names alone is **not** sufficient. The comparison must also cover column types, nullability, primary keys, unique and foreign-key constraints, indexes, and any other schema details.
   - The known, expected differences are these: uniqueness is enforced by unique indexes instead of `UNIQUE` constraints, columns lack SQL default values, and there are two extra indexes (`ix_incidents_severity`, `ix_incidents_type`).
   - Any other difference means the procedure does not apply.
3. **Stamp, then confirm.** Run `python -m alembic stamp head`, then `python -m alembic upgrade head`. The upgrade should report nothing to apply.
4. **Check the backend.** Start it and check `GET /health`.

> **Never stamp an unknown or older schema to `head`.** Stamping only records a version; it does not change tables. If the database came from an older version of SeaShield, or if you are unsure of its origin or whether its schema matches, **stop and investigate** instead of guessing a revision. Keep the backup until the database is confirmed working.

The Docker workflow is not affected: it runs migrations before the first start on its own volume.

#### Option B: Docker Compose

From the repository root:

```bash
docker compose up --build    # build the image and start the backend
docker compose down          # stop and remove the container; data is kept
```

- The container runs `alembic upgrade head`, then Uvicorn on `0.0.0.0:8000`. Compose publishes it on `127.0.0.1:8000` only.
- SQLite is stored in the `seashield-data` volume (see [persistence](#database-and-persistence)).
- Code changes require `docker compose up --build`; there is no auto-reload.
- `.env*` and `*.db` files are excluded from the image.
- Full details are in [`backend/README.md`](backend/README.md#docker-development).

#### Backend environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | SQLite file `backend/seashield.db` (host); `compose.yaml` sets `sqlite:////data/seashield.db` | SQLAlchemy database URL |
| `AUTH_REQUIRED` | `false` | Require a session for API and WebSocket access |
| `SESSION_SECRET` | development placeholder | Required when `AUTH_REQUIRED=true`; startup fails without it |
| `DEMO_USER_EMAIL` | `operator@seashield.local` | Demo user login |
| `DEMO_USER_PASSWORD` | development default | Demo user password |

**Check that the backend is up:** `GET http://localhost:8000/health` returns `{"status":"ok","database":"connected","mode":"simulation","version":"1.9.0"}`.

### 2. Frontend

From the repository root:

```bash
npm ci        # or: npm install
npm run dev
```

- Open **http://127.0.0.1:8080** (also reachable as `http://localhost:8080`). The dev server listens only on `127.0.0.1`, and `predev` stops with an error if port 8080 is already in use.
- To use a different backend, set `VITE_API_URL` (e.g. `VITE_API_URL=http://localhost:8001`) before `npm run dev` or `npm run build`.

### Useful scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server on `127.0.0.1:8080` |
| `npm run build` | Production build into `.output/` (does not type-check) |
| `npm run preview` | Preview the production build |
| `npm run test:unit` | Frontend unit tests (`node --test "src/**/*.test.mjs"`) |
| `npm run test:scripts` | Tests for the dev-port check |
| `npx tsc --noEmit` | Type-check |
| `npm run lint` | ESLint with Prettier as a rule |

---

## Testing and validation

### How to run

```bash
npm run test:unit
npm run test:scripts
npm run build
npx tsc --noEmit
npx eslint . --rule "prettier/prettier: [error, {endOfLine: auto}]"

# Backend, from backend/ (host)
python -m pytest

# Backend, in the Docker image
docker compose run --rm --no-deps backend python -m pytest
```

The ESLint command relaxes only Prettier's line-ending check. On Windows with `core.autocrlf=true`, plain `npm run lint` reports `Delete ␍` on almost every line, which is checkout noise rather than a code problem.

### Recorded results (clean clone at commit `067c00b`)

The results below come from a fresh clone of commit `067c00b`, the V3 foundation head, on Windows 11 with Node 24.20.0 and npm 11.19.0, with Docker in an isolated Compose project and a fresh volume. They describe that commit; re-run the checks before relying on them for a later commit.

**Passing:**

| Check | Result |
|---|---|
| `npm ci` | Succeeded |
| `npm run test:unit` | 8 passed |
| `npm run test:scripts` | 7 passed |
| `npm run build` | Succeeded |
| Docker build and start | Container healthy; migrations `0001`–`0005` applied to a fresh volume; `/health` returned 200 |
| SQLite persistence | Data survived `docker compose down` / `up` |
| WebSocket | `/ws/security` connected and received broadcasts |
| Browser integration | Dev frontend on `127.0.0.1:8080` against the Docker backend: all backend requests succeeded, no console errors |

**Known baseline issues (pre-existing, not yet fixed):**

| Check | Result |
|---|---|
| Backend pytest (in the Docker image, Python 3.12) | 32 passed, **1 known failure**: `tests/test_regressions.py::test_injection_targets_selected_vessel_and_persists_unique_events` (stale expected values) |
| `npx tsc --noEmit` | **4 errors**: `AppShell.tsx:86`, `backend.ts:15`, `safety-rounds.tsx:60`, `safety-rounds.tsx:144` |
| ESLint (with the line-ending override) | **62 errors, 13 warnings**, mostly Prettier formatting in files that were never formatted |

**Not run:** backend pytest in a fresh host virtual environment. Windows Application Control blocked a compiled SQLAlchemy module (`DLL load failed … An Application Control policy has blocked this file`) before any tests ran. That is a local machine policy, not a test failure; the Docker-image run above covers the backend suite.

**Windows note:** after `npm run build` or `npm run dev`, Git may show `src/routeTree.gen.ts` as modified. The generator writes LF line endings over a CRLF checkout; the content is unchanged, so don't commit it.

---

## Project structure

```text
SeaShield-V1.8-V2/
├── backend/
│   ├── app/main.py              # FastAPI app: routes, /ws/security, startup
│   ├── auth.py                  # optional demo authentication (AUTH_REQUIRED)
│   ├── websocket_manager.py     # in-memory WebSocket broadcast
│   ├── db/                      # SQLAlchemy engine, models, repositories
│   ├── alembic/                 # migrations (versions/0001–0005)
│   ├── models/, schemas/        # Pydantic contracts
│   ├── simulation/              # event library, scenarios, simulation engine
│   ├── security_engine/         # correlation rules, risk scoring, incidents
│   ├── tests/                   # pytest suite
│   ├── Dockerfile, .dockerignore
│   ├── requirements.txt
│   └── README.md
├── src/
│   ├── routes/                  # TanStack file routes (one per view)
│   ├── components/seashield/    # application components
│   ├── components/ui/           # shadcn/ui components (generated)
│   ├── lib/seashield/           # store, services, backend client, fixtures, unit tests
│   └── routeTree.gen.ts         # generated route tree (do not edit)
├── scripts/                     # assert-dev-port.mjs (+ test)
├── public/
├── compose.yaml                 # Docker Compose backend (development)
├── vite.config.ts
├── package.json, package-lock.json, .nvmrc
├── CLAUDE.md, AGENTS.md         # contributor and AI-agent guidance
├── LICENSE
└── README.md
```

The repository also contains `_patch_probe/`, a set of historical patch files that nothing references.

---

## Limitations and unverified areas

- **No real integrations:** no vessel, CCTV, sensor, access-control or network connections, and no vessel control. All data is simulated.
- **No real detection:** the correlation engine demonstrates rule-based logic on fictional events; it is not intrusion detection or real-time production monitoring.
- **PostgreSQL** has not been verified against a running server.
- **`AUTH_REQUIRED=true`** and its session-cookie behavior have not been verified end-to-end. With the frontend on `127.0.0.1:8080` and the API on `localhost:8000`, the two count as different sites, which may affect the `SameSite=Lax` cookie.
- **Docker** has been tested on Windows 11 with Docker Desktop only, not on Ubuntu.
- **No CI pipeline:** all recorded results are local runs.
- **No production deployment or hardening:** the Docker setup is a development environment only.
- **Known baseline issues** (TypeScript, ESLint, one backend test) remain open; see [Testing and validation](#testing-and-validation).

---

## Future development (planned)

The following are **goals, not implemented functionality**:

- A desktop client communicating with a central backend and, later, vessel/edge servers.
- PostgreSQL persistence validated against a running server (driver and schema support already exist in code).
- Real vessel/edge-server, CCTV and network-monitoring integrations.
- Advanced event correlation and AI-assisted detection.
- Expanded fleet analytics, compliance and reporting.
- Additional automated testing and a CI pipeline.
- Production-grade security controls and hardening.

```text
        Desktop client
              │  API / WebSocket
              ▼
   Central backend (Python / FastAPI)
        │                │
        ▼                ▼
  Security engine     Database
        │
        ▼
  Vessel / edge server
   │      │        │
  CCTV  Sensors  Network systems
```

---

## Development history

SeaShield is an independent project built through iterative prototyping. The V2 interface was originally developed partly with [Lovable](https://lovable.dev); the project no longer depends on Lovable tooling.

---

## License

SeaShield is proprietary software. Copyright 2026 nonkylmik. All rights reserved. See [LICENSE](LICENSE) for the full terms.
