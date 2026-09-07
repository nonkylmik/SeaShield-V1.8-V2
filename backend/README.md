# SeaShield V1.7 Backend

Simulation-only FastAPI backend for SeaShield. Security events persist through SQLAlchemy in PostgreSQL, with SQLite as a local fallback. It does not connect to real vessels, cameras, networks, or security infrastructure.

## Run

From the `backend` directory:

```powershell
..\.venv\Scripts\python.exe -m pip install -r requirements.txt
..\.venv\Scripts\python.exe -m alembic upgrade head
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```
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

Python 3.12+ is required by the project target. PostgreSQL and authentication are intentionally not included.

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
- `GET /api/v1/cameras?vessel_id=...`
- `GET /api/v1/events?vessel_id=...`
- `GET /api/v1/incidents`
- `GET /api/v1/incidents/{incident_id}`
- `PATCH /api/v1/incidents/{incident_id}`
- `GET /api/v1/simulation/status`
- `POST /api/v1/simulation/start` with `{ "scenario": "cyber|physical|systems" }`
- `POST /api/v1/simulation/next`
- `POST /api/v1/simulation/pause`, `/resume`, `/stop`, `/reset`

`GET /api/security-events` supports `limit`, `offset`, `severity`, `event_type`, `status`, `scenario`, `vessel_id`, `start`, and `end` filters. The V1.6 `/events` route remains available and reads the same persistent history. Set `DATABASE_URL` in the root `.env`; without it, the backend uses `backend/seashield.db`.

Authentication endpoints are `POST /api/auth/login`, `POST /api/auth/logout`, and `GET /api/auth/me`. They use an HTTP-only signed development session cookie. Configure `SESSION_SECRET`, `DEMO_USER_EMAIL`, and `DEMO_USER_PASSWORD` in `.env`.
