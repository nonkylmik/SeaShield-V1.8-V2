# SeaShield — Claude Code guide

@AGENTS.md

Simulation-only maritime security platform: FastAPI backend + TanStack Start/React frontend (built partly in Lovable). Nothing connects to real vessels, cameras, networks or sensors; keep it that way unless explicitly asked.

## Architecture

- `backend/app/main.py` — FastAPI app: all HTTP routes, `/ws/security` WebSocket, startup (create tables, seed demo safety rounds, sync engine).
- `backend/auth.py` — single demo user, HMAC-signed session cookie, `AUTH_REQUIRED` toggle (default off).
- `backend/websocket_manager.py` — in-memory broadcast to all clients.
- `backend/db/` — SQLAlchemy 2 (`database.py`, `models.py`), repositories in `db/repositories/`. `DATABASE_URL` from env or root `.env`; falls back to SQLite `backend/seashield.db`.
- `backend/alembic/` — migrations (`versions/YYYYMMDD_NNNN_*.py`).
- `backend/models/`, `backend/schemas/` — Pydantic contracts.
- `backend/simulation/`, `backend/security_engine/` — scenarios, event generation, correlation rules, risk scoring, in-memory incident manager.
- `backend/tests/` — pytest; `conftest.py` points `DATABASE_URL` at a throwaway `seashield_test.db`.
- `src/lib/seashield/backend.ts` — REST + WebSocket client (`VITE_API_URL`, default `http://localhost:8000`).
- `src/lib/seashield/store.ts` — client store; merges backend data with V2 visual fixtures from `data.ts` (sensors, access, cyber are fixtures, not backend data).
- `src/routes/` — TanStack file routes. Never edit generated files: `src/routeTree.gen.ts`; `src/components/ui/` is shadcn-generated.

State gotcha: the global `SimulationEngine` in `main.py` holds in-memory events/incidents/scores alongside the DB and is re-synced via `sync_engine_from_db`. Any change to events, incidents or scores must keep DB and engine consistent.

## Commands

Backend — run from `backend/`. Provisional minimum Python 3.12 (not yet declared in config). Tests, Alembic and Uvicorn are verified on 3.12 and 3.13; tests also pass on 3.14.
- `python -m pytest`
- `python -m uvicorn app.main:app --reload --port 8000`
- `python -m alembic upgrade head`

Startup and Alembic write to the configured DB (startup seeds demo data). When only verifying, set `DATABASE_URL=sqlite:///<scratch path>.db` so the local `seashield.db` is untouched.

Frontend — run from repo root with **npm**; `package-lock.json` is the only lockfile. Don't switch package managers or regenerate the lockfile without approval.
- `npm run dev` — Vite on `http://127.0.0.1:8080` only (also reachable as `http://localhost:8080`; strict port, and `predev` runs `scripts/assert-dev-port.mjs` first, failing if the port is in use).
- `npm run build` — Cloudflare Worker build into `.output/` (gitignored). Does not type-check.
- `npx tsc --noEmit` — type-check.
- `npm run lint` — ESLint (`**/*.{ts,tsx}` plus JS config files) with Prettier as the `prettier/prettier` rule. Don't run `npm run format` unless asked; it rewrites many files.

`tsc` and `lint` currently have pre-existing failures. Compare against the baseline before and after a change; only new failures count as regressions.

Line endings: the repo stores LF, but a system-level `core.autocrlf=true` checks files out as CRLF, so `npm run lint` reports `Delete ␍` on nearly every line. That's checkout noise, not a code problem. For a meaningful baseline without changing files or config, run (works in bash and PowerShell):
`npx eslint . --rule "prettier/prettier: [error, {endOfLine: auto}]"`
This is the same lint with only Prettier's line-ending check relaxed.

## Conventions

- Python: type hints, Pydantic v2 request models, `HTTPException` with 404/400/409 as existing routes do, UTC-aware datetimes (`datetime.now(timezone.utc)`).
- Data access goes through `db/repositories/`; no new queries in route handlers.
- Broadcast WebSocket messages only after the DB commit, via `broadcast_status_message(type, data)`.
- TypeScript is strict (`exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`); follow `.prettierrc`. The UI reaches the backend only via `services.ts`/`backend.ts`.

## V3 engineering standards (mandatory for new and changed code)

Existing code does not fully comply yet. Apply these to code you touch; don't refactor untouched code just to comply.

1. **Schema changes need an explicit, version-controlled Alembic migration.** Current behaviour: startup runs `create_all`, and migrations 0004/0005 call `Base.metadata.create_all` against the live models. Write new migrations with explicit `op.*` operations.
2. **Identity fields are untrusted.** Validate `actor`, `author`, `acknowledged_by`, `completed_by`, `created_by` and similar on the server, or derive them from the session. Current behaviour: these values are accepted from the request body.
3. **New string fields need length limits and validation** (Pydantic `Field(max_length=…)` matching the column size). Current behaviour: many existing text fields and `metadata` are unbounded.

## Security requirements

- Never commit secrets, `.env` or `*.db` files. Don't add hard-coded credentials.
- Validate all request input with Pydantic models.
- Mutating routes must stay behind `RequireSessionMiddleware`; don't add to `PUBLIC_PATHS` unless asked.
- Don't weaken CORS, cookie flags, the WebSocket auth check or `validate_auth_configuration`.

## API routes

Many routes exist under both a legacy unversioned path (e.g. `/vessels`, `/simulation/tick`) and `/api/v1/...`. During V3, keep legacy paths working unless one is shown to be unsafe or incompatible; flag that, don't silently remove it. New routes go under `/api/v1` only. Deprecation path for legacy routes (later milestone, approval needed): mark `deprecated=True` in OpenAPI, move the frontend to `/api/v1`, log legacy hits, then remove in a planned release.

## Git

- Never commit to `main`; work on feature branches (e.g. `feature/seashield-v3-*`).
- Never force-push, rewrite pushed history, or reset shared branches.
- Check `git status` and whether the branch is behind `origin` before switching branches; stop and report uncommitted work or divergence.
- Commit or push only with the user's explicit approval.

## Working rules

- Make focused edits. Don't rewrite working features without evidence; ask before broad refactors.
- Preserve API paths, response shapes and WebSocket message types the frontend depends on.
- Every bug fix or behaviour change gets a regression test in `backend/tests/`; run the full backend suite before reporting done.
- Report concisely: files changed (links), test results with real output for failures, anything skipped or unverified.
