# SeaShield V1.7 Backend

Simulation-only FastAPI backend for SeaShield. Data persists through SQLAlchemy in SQLite (`backend/seashield.db` by default; a Docker volume when run with Docker). PostgreSQL support exists in the code but has not yet been validated against a running PostgreSQL server. It does not connect to real vessels, cameras, networks, or security infrastructure.

## Run

From the `backend` directory:

```powershell
..\.venv\Scripts\python.exe -m pip install -r requirements.txt
..\.venv\Scripts\python.exe -m alembic upgrade head
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

## Docker (development)

An optional alternative to the host workflow above, which keeps working unchanged. Only the backend runs in Docker; the frontend still runs on the host with `npm run dev` and reaches the API at its default `http://localhost:8000`.

From the repository root:

```bash
docker compose up --build        # build the image and start the backend
docker compose down              # stop and remove the container (data is kept)
```

- **Startup:** the container runs `alembic upgrade head`, then Uvicorn on `0.0.0.0:8000` inside the container. Compose publishes it on `127.0.0.1:8000` only, so it is not reachable from other machines. Code changes need `docker compose up --build`; there is no auto-reload.
- **Database:** SQLite at `/data/seashield.db` inside the named Docker volume `seashield-data`. It survives `docker compose down` and container rebuilds. It is separate from the host's `backend/seashield.db`. `docker compose down -v` deletes the volume and all its data.
- **Environment variables:** `DATABASE_URL` is set by `compose.yaml`. `AUTH_REQUIRED`, `SESSION_SECRET`, `DEMO_USER_EMAIL` and `DEMO_USER_PASSWORD` are passed through from your shell, or from a root `.env` file, which Docker Compose reads automatically. When unset, the backend's defaults apply, exactly as on the host (authentication off). `AUTH_REQUIRED=true` requires `SESSION_SECRET`.
- **Secrets:** the image is built from `backend/` only, and `backend/.dockerignore` excludes `.env*` and `*.db`, so no local secrets or databases are copied into it.
- **Port 8000:** stop any host-run backend first; only one of them can use the port.

# SeaShield V1.5 Backend

Simulation-only Python backend for the SeaShield maritime security desktop prototype. It generates fictional telemetry in memory and never connects to real vessels, cameras, networks, credentials, or security infrastructure.

## Architecture

- `models/`: Pydantic event, vessel, camera, and incident contracts.
- `simulation/event_generator.py`: seeded random event generation and safe event construction.
- `simulation/scenario_manager.py`: deterministic scenarios and lifecycle controls.
- `simulation/simulation_engine.py`: framework-independent coordinator used by tests and API.
- `security_engine/event_correlation.py`: deterministic rules returning structured correlation results.
- `security_engine/risk_scoring.py`: bounded 0-100 vessel score calculation.
- `security_engine/incident_manager.py`: in-memory incident lifecycle and history.
- `app/main.py`: thin FastAPI adapter over the engine.

## Setup

From the repository root on Windows PowerShell:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r SeaShield\backend\requirements.txt
```

Python 3.12+ is required by the project target.

## Run

```powershell
cd SeaShield\backend
python -m uvicorn app.main:app --reload --port 8000
```

Open `http://localhost:8000/docs` for the OpenAPI UI. The primary endpoints are `GET /health`, `GET /vessels`, `GET /events`, `GET /incidents`, `GET /security/{vessel_id}`, and the `/simulation/*` controls. Start a scenario with `POST /simulation/scenario/cyber-intrusion/start`, then advance it with `POST /simulation/tick`.

## Test

```powershell
cd SeaShield\backend
python -m pytest
```

The tests cover Pydantic validation, seeded generation, scenario controls, correlation, bounded scoring, incident lifecycle, and engine reset behavior.

All events are fictional labels. For example, `FAILED_AUTHENTICATION` does not attempt authentication, and `UNKNOWN_DEVICE` does not scan a network.

API docs are available at `http://localhost:8000/docs`.

## API surface

- `GET /health`
- `GET /api/v1/vessels`
- `GET /api/v1/vessels/{vessel_id}`
- `GET /api/v1/fleet/security-summary`
- `GET /api/v1/cameras?vessel_id=...`
- `GET /api/v1/events?vessel_id=...`
- `GET /api/v1/incidents`
- `GET /api/v1/incidents/{incident_id}`
- `PATCH /api/v1/incidents/{incident_id}`
- `POST /api/v1/incidents/{incident_id}/reopen` with `{ "reason": "..." }`
- `GET /api/v1/simulation/status`
- `GET /api/v1/simulation/log?limit=40`
- `POST /api/v1/simulation/start` with `{ "scenario": "cyber|physical|systems" }`
- `POST /api/v1/simulation/next`
- `POST /api/v1/simulation/pause`, `/resume`, `/stop`, `/reset`

`GET /api/v1/simulation/log` lists what the simulation recorded, newest first: events from scenario steps and manual injections (not safety-round reports or events ingested over REST), each with `scenario_label`, `status` and the `incident_ids` it was correlated into. The UI's simulation console shows this log; a failed injection records nothing, so it has no entry (the UI reports the failure separately). If only this endpoint fails, the UI keeps refreshing everything else, keeps the last log it received and marks the log as unavailable. Reset resolves logged events but keeps them.

### Vessel security status

`status` on every vessel (`/vessels`, `/api/v1/vessels`, `/api/v1/vessels/{vessel_id}`, `/security/{vessel_id}`) and in `security_score_changed` / `vessel_status_changed` messages is derived from the current `score` by `backend/models/security_status.py` and is one of:

| `status`   | `score` |
| ---------- | ------- |
| `SECURE`   | 86–100  |
| `ELEVATED` | 72–85   |
| `WARNING`  | 55–71   |
| `CRITICAL` | 0–54    |

This changed in V4: earlier versions returned only `SECURE` (85–100), `WARNING` (60–84) and `CRITICAL` (0–59). The frontend is the only client and is deployed together with the backend; before any third-party client depends on `/api/v1`, a change like this needs explicit versioning or a compatibility plan.

### Incident lifecycle

`PATCH /api/v1/incidents/{incident_id}` changes status only along these transitions (`models/incidents.py`); any other status change returns 409 and changes nothing:

| From                         | To                                                         |
| ---------------------------- | ---------------------------------------------------------- |
| `NEW`                        | `INVESTIGATING`, `CONTAINED`, `RESOLVED`, `FALSE POSITIVE` |
| `INVESTIGATING`              | `CONTAINED`, `RESOLVED`, `FALSE POSITIVE`                  |
| `CONTAINED`                  | `INVESTIGATING`, `RESOLVED`, `FALSE POSITIVE`              |
| `RESOLVED`, `FALSE POSITIVE` | closed: only `POST .../reopen`                             |

Closing an incident resolves its linked events. `POST /api/v1/incidents/{incident_id}/reopen` (a required `reason`, up to 500 characters) returns a `RESOLVED` or `FALSE POSITIVE` incident to `INVESTIGATING`, reopens its linked events so their score penalties return, and records one activity entry with the reason; it adds no evidence links and returns 409 for an incident that is not closed. Status changes and reopening commit together with the recalculated scores. Activity entries record the signed-in user; a name in the request is used only when authentication is disabled. Every incident payload includes `allowed_transitions` and `can_reopen`, which the UI uses to offer only valid actions.

### Vessel last communication

`last_communication` is the time of the most recent security event recorded for the vessel, from any source (simulation ticks and injections, `POST /api/security-events`, safety-round reports). It uses the event's own timestamp, clamped to the server's current time, and only moves forward. Score recalculation, startup sync, reset and event deletion never change it, for any vessel. A vessel row created for the first time starts at its creation time. The UI measures its age against the real clock and shows a missing or invalid value as unknown.

`GET /api/v1/fleet/security-summary` returns `{ "vessel_count", "average_score", "average_status" }`: the fleet's mean score (rounded half up) and the classification of that average under the same bands. It is not the worst vessel's status; the UI shows the fleet status (the most severe vessel status) separately.

Reset resolves open security events and closes incidents that are still open (`NEW`, `INVESTIGATING`, `CONTAINED`) as `RESOLVED`, adding a "Closed by simulation reset" entry to each one's activity timeline. `RESOLVED` and `FALSE POSITIVE` incidents and all investigation notes are left unchanged. These changes and the recalculated scores commit in one transaction; if it fails, nothing changes.

`GET /api/security-events` supports `limit`, `offset`, `severity`, `event_type`, `status`, `scenario`, `vessel_id`, `start`, and `end` filters. The V1.6 `/events` route remains available and reads the same persistent history. Set `DATABASE_URL` in the root `.env`; without it, the backend uses `backend/seashield.db`.

`POST /api/security-events` returns 404 for an unknown `vessel_id` and 409 for an existing `event_id`. `DELETE /api/security-events/{event_id}` returns 404 for an unknown event and 409 when the event is linked to an incident: incident evidence is never removed, so the event, its incident links and its acknowledgement stay intact. Deleting an unlinked event also deletes its acknowledgement. Both routes commit the event change and the recalculated vessel scores in one transaction, then broadcast `security_event_created` or `security_event_deleted`; if the transaction fails, nothing is written and no score notification is sent. A duplicate `event_id` that a concurrent request commits first also returns 409. Deletion checks incident links only after it holds the SQLite write lock, and incident creation verifies its linked events under the same lock, so a linked event cannot be deleted even when both requests run concurrently (this relies on SQLite's single writer; PostgreSQL would need a database constraint, which is not yet in place). Deletion is unrestricted for any signed-in user in the local pilot; soft deletion or administrative permissions are to be decided before external users get access.

Authentication endpoints are `POST /api/auth/login`, `POST /api/auth/logout`, and `GET /api/auth/me`. They use an HTTP-only signed development session cookie. Configure `SESSION_SECRET`, `DEMO_USER_EMAIL`, and `DEMO_USER_PASSWORD` in `.env`.
