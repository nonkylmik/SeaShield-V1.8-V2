from datetime import datetime, timezone
from uuid import uuid4

from fastapi import Cookie, Depends, FastAPI, HTTPException, Query, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware

from auth import SESSION_COOKIE, SESSION_TTL_SECONDS, auth_required, authenticate, create_session, read_session, validate_auth_configuration
from db.database import Base, SessionLocal, engine as db_engine, get_db
from db.events import create_event, delete_event, from_record, get_event, list_events, load_events
from db.models import IncidentRecord, VesselRecord
from db.repositories.event_repository import acknowledge_event, acknowledged_event_ids, create_event_record, list_event_records, resolve_all_open_events, resolve_safety_finding_events, set_event_status
from db.repositories.incident_repository import add_incident_activity, add_incident_note, close_open_incident_records, create_incident_record, get_incident_record, get_related_event_ids, list_incident_activity, list_incident_notes, list_incident_records, next_incident_id, update_incident_record
from db.repositories.safety_repository import (
    cancel_safety_round,
    complete_safety_round,
    create_safety_finding,
    create_safety_round,
    finding_response,
    InvalidRoundTransition,
    get_safety_checkpoint,
    get_safety_finding,
    get_safety_round,
    list_safety_checkpoints,
    list_safety_findings,
    list_safety_rounds,
    list_safety_round_templates,
    round_response,
    start_safety_round,
    update_safety_checkpoint,
    update_safety_finding,
)
from db.repositories.security_repository import append_security_score, latest_security_score
from db.repositories.vessel_repository import get_vessel_record, list_vessel_records, to_vessel_model, upsert_vessel_record
from models.events import EventCategory, SecurityEvent, Severity
from models.incidents import Incident, IncidentCreate, IncidentNoteCreate, IncidentStatus, IncidentUpdate
from models.safety_rounds import SafetyCheckpointPatch, SafetyCheckpointStatus, SafetyFindingCreate, SafetyFindingUpdate, SafetyRoundCreate
from schemas.auth import LoginRequest, LoginResponse, UserResponse
from schemas.security_events import EventAcknowledge, SecurityEventCreate, SecurityEventResponse
from simulation.simulation_engine import SimulationEngine
from websocket_manager import ConnectionManager

APP_VERSION = "1.9.0"

class ScenarioRequest(BaseModel):
    scenario: str


class InjectEventRequest(BaseModel):
    vessel_id: str
    event_type: str


PUBLIC_PATHS = {"/health", "/api/auth/login", "/api/auth/logout", "/api/auth/me", "/api/auth/config", "/docs", "/redoc", "/openapi.json"}


class RequireSessionMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if auth_required() and request.method != "OPTIONS" and request.url.path not in PUBLIC_PATHS:
            if read_session(request.cookies.get(SESSION_COOKIE)) is None:
                return JSONResponse({"detail": "Not authenticated"}, status_code=401)
        return await call_next(request)


app = FastAPI(title="SeaShield Security API", version=APP_VERSION, description="Simulation-only maritime security backend.")
app.add_middleware(RequireSessionMiddleware)
app.add_middleware(CORSMiddleware, allow_origin_regex=r"https?://(localhost|127\.0\.0\.1):\d+", allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.state.websocket_manager = ConnectionManager()
engine = SimulationEngine(seed=7)
engine.set_broadcaster(app.state.websocket_manager.broadcast)


def event_response(record, acknowledged: bool = False):
    event = from_record(record)
    return SecurityEventResponse(id=record.id, created_at=record.created_at, acknowledged=acknowledged, **event.model_dump())


def incident_response(record: IncidentRecord, related_event_ids: list[str] | None = None) -> dict:
    related = related_event_ids if related_event_ids is not None else []
    return {
        "incident_id": record.incident_id,
        "vessel_id": record.vessel_id,
        "type": record.type,
        "title": record.title,
        "severity": record.severity,
        "status": record.status,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
        "description": record.description,
        "related_event_ids": related,
        "affected_systems": [],
        "assigned_operator": record.assigned_operator,
        "investigation_notes": record.investigation_notes,
        "recommended_action": record.recommended_action,
    }


def incident_payload(db: Session, record: IncidentRecord) -> dict:
    payload = incident_response(record, get_related_event_ids(db, record.incident_id))
    payload["notes"] = [
        {"note_id": note.note_id, "author": note.author, "body": note.body, "created_at": note.created_at}
        for note in list_incident_notes(db, record.incident_id)
    ]
    activities = list_incident_activity(db, record.incident_id)
    payload["timeline"] = [
        {"id": f"act-{activity.id}", "text": activity.text, "actor": activity.actor, "created_at": activity.created_at}
        for activity in activities
    ] or [{"id": f"{record.incident_id}-opened", "text": "Incident opened.", "actor": None, "created_at": record.created_at}]
    return payload


async def broadcast_status_message(message_type: str, data: dict) -> None:
    await app.state.websocket_manager.broadcast({
        "type": message_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": data,
    })


def incident_from_record(db: Session, record: IncidentRecord) -> Incident:
    return Incident(
        incident_id=record.incident_id,
        vessel_id=record.vessel_id,
        type=record.type,
        title=record.title,
        severity=Severity(record.severity),
        status=IncidentStatus(record.status),
        created_at=record.created_at,
        updated_at=record.updated_at,
        description=record.description,
        related_event_ids=get_related_event_ids(db, record.incident_id),
        affected_systems=[],
        assigned_operator=record.assigned_operator,
        investigation_notes=record.investigation_notes,
        recommended_action=record.recommended_action,
    )


def persist_vessel_scores(db: Session) -> None:
    for vessel in engine.vessels:
        upsert_vessel_record(db, vessel_id=vessel.id, name=vessel.name, imo=vessel.imo, base_score=vessel.base_score, score=vessel.score, status=vessel.status)
        latest_score = latest_security_score(db, vessel.id)
        if latest_score is None or latest_score.score != vessel.score:
            append_security_score(
                db,
                vessel_id=vessel.id,
                score=vessel.score,
                previous_score=latest_score.score if latest_score else None,
                reason="score_recalculation",
            )


def sync_engine_from_db(db: Session) -> None:
    engine.events = load_events(db)
    engine.incidents._incidents = [incident_from_record(db, record) for record in list_incident_records(db)]
    engine.recalculate()
    persist_vessel_scores(db)


def create_safety_event_record(
    db: Session,
    *,
    vessel_id: str,
    event_type: str,
    title: str,
    description: str,
    severity: str,
    source: str = "Safety Round",
    commit: bool = True,
    event_status: str = "OPEN",
    metadata: dict | None = None,
) -> SecurityEvent:
    event = SecurityEvent(
        event_id=f"{event_type}-{uuid4().hex}",
        vessel_id=vessel_id,
        event_type=event_type,
        category=EventCategory.PHYSICAL,
        severity=Severity[severity.upper()],
        source=source,
        description=description,
        title=title,
        status=event_status,
        metadata={"source": "safety_round", **(metadata or {})},
    )
    return create_event(db, event, "safety-rounds", commit=commit)


def seed_safety_demo_data(db: Session) -> None:
    if list_safety_rounds(db, limit=1):
        return

    demo_rounds = [
        {
            "vessel_id": "baltic-guardian",
            "round_type": "Evening Safety & Security Round",
            "assigned_to": "Deck Officer",
            "status": "COMPLETED",
            "checkpoints": ["PASS", "PASS", "PASS", "WARNING", "FAIL", "PASS", "PASS", "PASS"],
        },
        {
            "vessel_id": "ocean-sentinel",
            "round_type": "Security Round",
            "assigned_to": "Security Officer",
            "status": "IN_PROGRESS",
            "checkpoints": ["PASS", "PASS", "WARNING"],
        },
        {
            "vessel_id": "northern-star",
            "round_type": "Pre-Departure Safety Round",
            "assigned_to": "Chief Officer",
            "status": "PLANNED",
            "checkpoints": [],
        },
    ]

    for round_data in demo_rounds:
        payload = create_safety_round(
            db,
            vessel_id=round_data["vessel_id"],
            round_type=round_data["round_type"],
            assigned_to=round_data["assigned_to"],
            planned_start=datetime.now(timezone.utc),
            notes="Deterministic SeaShield demonstration record.",
            template_name=round_data["round_type"],
            commit=False,
        )
        round_id = payload["round_id"]
        record = start_safety_round(db, round_id, commit=False) if round_data["status"] != "PLANNED" else get_safety_round(db, round_id)
        if record is None:
            raise RuntimeError(f"Failed to create demo safety round {round_id}")

        if round_data["status"] != "PLANNED":
            for checkpoint, status in zip(payload["checkpoints"], round_data["checkpoints"]):
                severity = "HIGH" if status == "FAIL" else "MEDIUM" if status == "WARNING" else "INFO"
                updated = update_safety_checkpoint(
                    db,
                    round_id=round_id,
                    checkpoint_id=checkpoint["checkpoint_id"],
                    status=status,
                    severity=severity,
                    notes="Demonstration observation recorded." if status in {"WARNING", "FAIL"} else "",
                    completed_by=round_data["assigned_to"],
                    commit=False,
                )
                if status not in {"WARNING", "FAIL"}:
                    continue
                finding = create_safety_finding(
                    db,
                    round_id=round_id,
                    checkpoint_id=updated.checkpoint_id,
                    vessel_id=record.vessel_id,
                    title=f"{updated.name} requires attention",
                    description=updated.notes,
                    location=updated.location,
                    severity=updated.severity,
                    created_by=round_data["assigned_to"],
                    assigned_to=round_data["assigned_to"],
                    commit=False,
                )
                event = create_safety_event_record(
                    db,
                    vessel_id=record.vessel_id,
                    event_type="SAFETY_CHECKPOINT_FAILED" if status == "FAIL" else "SAFETY_CHECKPOINT_WARNING",
                    title=f"{updated.name} marked {status}",
                    description=updated.notes,
                    severity=updated.severity,
                    commit=False,
                    metadata={"round_id": round_id, "checkpoint_id": updated.checkpoint_id, "finding_id": finding.finding_id},
                )
                if status == "WARNING" and round_data["status"] == "COMPLETED":
                    update_safety_finding(
                        db,
                        finding.finding_id,
                        status="RESOLVED",
                        assigned_to=round_data["assigned_to"],
                        resolution_notes="Warning reviewed and condition corrected.",
                        commit=False,
                    )
                    resolve_safety_finding_events(db, finding.finding_id)
                    event.status = "RESOLVED"

        if round_data["status"] == "COMPLETED":
            complete_safety_round(db, round_id, commit=False)

    db.commit()


@app.on_event("startup")
def initialize_database() -> None:
    validate_auth_configuration()
    Base.metadata.create_all(bind=db_engine)
    with SessionLocal() as db:
        seed_safety_demo_data(db)
        sync_engine_from_db(db)


@app.get("/health")
def health() -> dict[str, str]:
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        return {"status": "ok", "database": "connected", "mode": "simulation", "version": APP_VERSION}
    except Exception:
        return {"status": "degraded", "database": "unavailable", "mode": "simulation", "version": APP_VERSION}


@app.post("/api/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest, response: Response):
    user = authenticate(payload.email, payload.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    response.set_cookie(SESSION_COOKIE, create_session(user), max_age=SESSION_TTL_SECONDS, httponly=True, samesite="lax", secure=False)
    return {"message": "Login successful", "user": UserResponse(email=user.email, name=user.name, role=user.role)}


@app.post("/api/auth/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE)


@app.get("/api/auth/me", response_model=UserResponse)
def current_user(session: str | None = Cookie(default=None, alias=SESSION_COOKIE)):
    user = read_session(session)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return UserResponse(email=user.email, name=user.name, role=user.role)


@app.get("/api/auth/config")
def auth_config() -> dict[str, bool]:
    return {"auth_required": auth_required()}


@app.get("/vessels")
@app.get("/api/v1/vessels")
def get_vessels(db: Session = Depends(get_db)):
    records = list_vessel_records(db)
    if records:
        return [to_vessel_model(record) for record in records]
    return engine.vessels


@app.get("/api/v1/vessels/{vessel_id}")
def get_vessel(vessel_id: str, db: Session = Depends(get_db)):
    record = get_vessel_record(db, vessel_id)
    if record is None:
        vessel = next((item for item in engine.vessels if item.id == vessel_id), None)
        if vessel is None:
            raise HTTPException(status_code=404, detail="Vessel not found")
        return vessel
    return to_vessel_model(record)


@app.get("/api/v1/cameras")
def get_cameras(vessel_id: str | None = None):
    if vessel_id and next((item for item in engine.vessels if item.id == vessel_id), None) is None:
        raise HTTPException(status_code=404, detail="Vessel not found")
    return [camera for camera in engine.cameras if vessel_id is None or camera.vessel_id == vessel_id]


@app.get("/events")
@app.get("/api/v1/events")
def get_events(vessel_id: str | None = None, db: Session = Depends(get_db)):
    records = list_event_records(db, limit=500, offset=0, vessel_id=vessel_id)
    return [from_record(event) for event in records]


def persist_tick(db: Session):
    return persist_result(db, engine.tick(), engine.scenarios.name)


def persist_result(db: Session, result, scenario: str | None):
    if result is None:
        return None
    create_event_record(
        db,
        event_id=result.event.event_id,
        timestamp=result.event.timestamp,
        vessel_id=result.event.vessel_id,
        event_type=result.event.event_type,
        category=result.event.category.value,
        severity=result.event.severity.value,
        source=result.event.source,
        description=result.event.description,
        status=result.event.status.value,
        title=result.event.title,
        confidence=result.event.confidence,
        scenario=scenario,
        metadata=result.event.metadata,
    )
    for vessel in engine.vessels:
        upsert_vessel_record(db, vessel_id=vessel.id, name=vessel.name, imo=vessel.imo, base_score=vessel.base_score, score=vessel.score, status=vessel.status)
        latest_score = latest_security_score(db, vessel.id)
        if latest_score is None or latest_score.score != vessel.score:
            append_security_score(db, vessel_id=vessel.id, score=vessel.score, previous_score=latest_score.score if latest_score else None, reason="simulation_update")
    if result.correlation:
        incident = engine.incidents.create_from_correlation(result.correlation)
        create_incident_record(
            db,
            incident_id=incident.incident_id,
            vessel_id=incident.vessel_id,
            type=incident.type,
            title=incident.title,
            severity=incident.severity.value,
            description=incident.description,
            status=incident.status.value,
            related_event_ids=list(incident.related_event_ids),
        )
    return result


@app.get("/api/security-events", response_model=list[SecurityEventResponse])
def get_security_events(limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0), severity: str | None = None, event_type: str | None = None, status: str | None = None, scenario: str | None = None, vessel_id: str | None = None, start: datetime | None = None, end: datetime | None = None, db: Session = Depends(get_db)):
    records = list_events(db, limit=limit, offset=offset, severity=severity, event_type=event_type, status=status, scenario=scenario, vessel_id=vessel_id, start=start, end=end)
    acknowledged = acknowledged_event_ids(db, [event.event_id for event in records])
    return [event_response(event, event.event_id in acknowledged) for event in records]


@app.get("/api/security-events/{event_id}", response_model=SecurityEventResponse)
def get_security_event(event_id: str, db: Session = Depends(get_db)):
    event = get_event(db, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Security event not found")
    return event_response(event, event.event_id in acknowledged_event_ids(db, [event.event_id]))


@app.post("/api/security-events/{event_id}/acknowledge", response_model=SecurityEventResponse)
async def acknowledge_security_event(event_id: str, payload: EventAcknowledge | None = None, db: Session = Depends(get_db)):
    if not acknowledge_event(db, event_id, (payload or EventAcknowledge()).acknowledged_by):
        raise HTTPException(status_code=404, detail="Security event not found")
    record = get_event(db, event_id)
    await broadcast_status_message("event_acknowledged", {"event_id": event_id})
    return event_response(record, True)


@app.post("/api/security-events", response_model=SecurityEventResponse, status_code=201)
def post_security_event(payload: SecurityEventCreate, db: Session = Depends(get_db)):
    if get_event(db, payload.event_id):
        raise HTTPException(status_code=409, detail="Event ID already exists")
    return event_response(create_event(db, SecurityEvent(**payload.model_dump()), payload.scenario))


@app.delete("/api/security-events/{event_id}", status_code=204)
def remove_security_event(event_id: str, db: Session = Depends(get_db)):
    if not delete_event(db, event_id):
        raise HTTPException(status_code=404, detail="Security event not found")


@app.get("/incidents")
@app.get("/api/v1/incidents")
def get_incidents(db: Session = Depends(get_db)):
    records = list_incident_records(db)
    if records:
        return [incident_payload(db, record) for record in records]
    return engine.incidents.get_all()


@app.get("/security/{vessel_id}")
def get_security(vessel_id: str, db: Session = Depends(get_db)):
    record = get_vessel_record(db, vessel_id)
    if record is None:
        vessel = next((item for item in engine.vessels if item.id == vessel_id), None)
        if vessel is None:
            raise HTTPException(status_code=404, detail="Vessel not found")
        return {"vessel_id": vessel.id, "score": vessel.score, "status": vessel.status}
    return {"vessel_id": record.vessel_id, "score": record.score, "status": record.status}


@app.get("/incidents/{incident_id}")
@app.get("/api/v1/incidents/{incident_id}")
def get_incident(incident_id: str, db: Session = Depends(get_db)):
    record = get_incident_record(db, incident_id)
    if record is None:
        incident = engine.incidents.get(incident_id)
        if incident is None:
            raise HTTPException(status_code=404, detail="Incident not found")
        return incident
    return incident_payload(db, record)


@app.patch("/incidents/{incident_id}")
@app.patch("/api/v1/incidents/{incident_id}")
async def update_incident(incident_id: str, update: IncidentUpdate, db: Session = Depends(get_db)):
    record = get_incident_record(db, incident_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    changes = update.model_dump(exclude_unset=True, exclude={"actor"})
    if not changes:
        return incident_payload(db, record)
    updated = update_incident_record(
        db,
        incident_id,
        status=update.status.value if update.status is not None else None,
        investigation_notes=update.investigation_notes,
        assigned_operator=update.assigned_operator,
        severity=update.severity.value if update.severity is not None else None,
    )
    change_text = ", ".join(f"{key} → {value.value if hasattr(value, 'value') else value}" for key, value in changes.items())
    add_incident_activity(db, incident_id, f"Operator update: {change_text}.", actor=update.actor or "Operator")
    if update.status in {IncidentStatus.RESOLVED, IncidentStatus.FALSE_POSITIVE}:
        set_event_status(db, get_related_event_ids(db, incident_id), "RESOLVED")
    sync_engine_from_db(db)
    await broadcast_status_message("incident_updated", {"incident_id": incident_id, "status": updated.status})
    return incident_payload(db, updated)


@app.post("/api/v1/incidents", status_code=201)
async def create_manual_incident(payload: IncidentCreate, db: Session = Depends(get_db)):
    if get_vessel_record(db, payload.vessel_id) is None and not any(vessel.id == payload.vessel_id for vessel in engine.vessels):
        raise HTTPException(status_code=404, detail="Vessel not found")
    record = create_incident_record(
        db,
        incident_id=next_incident_id(db),
        vessel_id=payload.vessel_id,
        type=payload.type,
        title=payload.title,
        severity=payload.severity.value,
        description=payload.description,
        assigned_operator=payload.assigned_operator or "J. Dawson",
    )
    add_incident_activity(db, record.incident_id, "Incident opened manually by operator.", actor=payload.assigned_operator or "J. Dawson")
    sync_engine_from_db(db)
    await broadcast_status_message("incident_created", {"incident_id": record.incident_id, "vessel_id": record.vessel_id})
    return incident_payload(db, record)


@app.post("/api/v1/incidents/{incident_id}/notes", status_code=201)
async def create_incident_note(incident_id: str, payload: IncidentNoteCreate, db: Session = Depends(get_db)):
    if get_incident_record(db, incident_id) is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    note = add_incident_note(db, incident_id, author=payload.author, body=payload.body)
    add_incident_activity(db, incident_id, "Investigation note added.", actor=payload.author)
    await broadcast_status_message("incident_updated", {"incident_id": incident_id, "change": "note_added"})
    return {"note_id": note.note_id, "incident_id": note.incident_id, "author": note.author, "body": note.body, "created_at": note.created_at}


@app.get("/simulation/status")
@app.get("/api/v1/simulation/status")
def simulation_status():
    return {"scenario": engine.scenarios.name, "status": engine.scenarios.status, "index": engine.scenarios.index}


@app.get("/api/v1/safety-rounds")
def get_safety_rounds_endpoint(
    vessel_id: str | None = None,
    status: str | None = None,
    round_type: str | None = None,
    assigned_to: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    if start and end and start > end:
        raise HTTPException(status_code=400, detail="Start date must be before end date")
    records = list_safety_rounds(
        db,
        vessel_id=vessel_id,
        status=status,
        round_type=round_type,
        assigned_to=assigned_to,
        start=start,
        end=end,
        limit=limit,
        offset=offset,
    )
    return [round_response(record, list_safety_checkpoints(db, record.round_id)) for record in records]


@app.get("/api/v1/safety-round-templates")
def get_safety_round_templates_endpoint():
    return list_safety_round_templates()


@app.get("/api/v1/safety-rounds/{round_id}")
def get_safety_round_endpoint(round_id: str, db: Session = Depends(get_db)):
    record = get_safety_round(db, round_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Safety round not found")
    return round_response(record, list_safety_checkpoints(db, record.round_id))


@app.post("/api/v1/safety-rounds", status_code=201)
async def create_safety_round_endpoint(payload: SafetyRoundCreate, db: Session = Depends(get_db)):
    vessel = get_vessel_record(db, payload.vessel_id)
    if vessel is None and not any(item.id == payload.vessel_id for item in engine.vessels):
        raise HTTPException(status_code=404, detail="Vessel not found")
    round_payload = create_safety_round(
        db,
        vessel_id=payload.vessel_id,
        round_type=payload.round_type,
        assigned_to=payload.assigned_to,
        planned_start=payload.planned_start,
        notes=payload.notes,
        template_name=payload.template_name or payload.round_type,
    )
    await broadcast_status_message("safety_round_created", {"round_id": round_payload["round_id"], "vessel_id": payload.vessel_id, "status": "PLANNED"})
    return round_payload


@app.post("/api/v1/safety-rounds/{round_id}/start")
async def start_safety_round_endpoint(round_id: str, db: Session = Depends(get_db)):
    try:
        record = start_safety_round(db, round_id, commit=False)
    except InvalidRoundTransition as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if record is None:
        raise HTTPException(status_code=404, detail="Safety round not found")
    event_record = create_safety_event_record(db, vessel_id=record.vessel_id, event_type="SAFETY_ROUND_STARTED", title=f"Safety round {record.round_id} started", description=f"{record.round_type} began for {record.vessel_id}.", severity="INFO", source="Safety Round", commit=False)
    db.commit()
    sync_engine_from_db(db)
    await broadcast_status_message("safety_round_started", {"round_id": round_id, "vessel_id": record.vessel_id, "status": record.status})
    await broadcast_status_message("security_event_created", {"event_id": event_record.event_id, "event_type": event_record.event_type, "severity": event_record.severity})
    return round_response(record, list_safety_checkpoints(db, record.round_id))


@app.post("/api/v1/safety-rounds/{round_id}/complete")
async def complete_safety_round_endpoint(round_id: str, db: Session = Depends(get_db)):
    record = get_safety_round(db, round_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Safety round not found")
    try:
        record = complete_safety_round(db, round_id, commit=False)
    except InvalidRoundTransition as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    create_safety_event_record(db, vessel_id=record.vessel_id, event_type="SAFETY_ROUND_COMPLETED", title=f"Safety round {record.round_id} completed", description=f"{record.round_type} completed for {record.vessel_id}.", severity="INFO", source="Safety Round", commit=False)
    db.commit()
    await broadcast_status_message("safety_round_completed", {"round_id": round_id, "vessel_id": record.vessel_id, "status": record.status})
    return round_response(record, list_safety_checkpoints(db, record.round_id))


@app.post("/api/v1/safety-rounds/{round_id}/cancel")
async def cancel_safety_round_endpoint(round_id: str, db: Session = Depends(get_db)):
    try:
        record = cancel_safety_round(db, round_id, commit=False)
    except InvalidRoundTransition as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if record is None:
        raise HTTPException(status_code=404, detail="Safety round not found")
    db.commit()
    await broadcast_status_message("safety_round_cancelled", {"round_id": round_id, "status": record.status})
    return round_response(record, list_safety_checkpoints(db, record.round_id))


@app.get("/api/v1/safety-rounds/{round_id}/checkpoints")
def get_safety_round_checkpoints_endpoint(round_id: str, db: Session = Depends(get_db)):
    if get_safety_round(db, round_id) is None:
        raise HTTPException(status_code=404, detail="Safety round not found")
    return [
        {
            "id": checkpoint.id,
            "checkpoint_id": checkpoint.checkpoint_id,
            "round_id": checkpoint.round_id,
            "name": checkpoint.name,
            "category": checkpoint.category,
            "location": checkpoint.location,
            "description": checkpoint.description,
            "sequence": checkpoint.sequence,
            "required": checkpoint.required,
            "status": checkpoint.status,
            "severity": checkpoint.severity,
            "notes": checkpoint.notes,
            "completed_at": checkpoint.completed_at.isoformat() if checkpoint.completed_at else None,
            "completed_by": checkpoint.completed_by,
        }
        for checkpoint in list_safety_checkpoints(db, round_id)
    ]


@app.patch("/api/v1/safety-rounds/{round_id}/checkpoints/{checkpoint_id}")
async def update_safety_round_checkpoint_endpoint(round_id: str, checkpoint_id: str, payload: SafetyCheckpointPatch, db: Session = Depends(get_db)):
    checkpoint = get_safety_checkpoint(db, round_id, checkpoint_id)
    if checkpoint is None:
        raise HTTPException(status_code=404, detail="Checkpoint not found")
    round_record = get_safety_round(db, round_id)
    previous_status = checkpoint.status
    previous_severity = checkpoint.severity
    try:
        updated = update_safety_checkpoint(
            db,
            round_id=round_id,
            checkpoint_id=checkpoint_id,
            status=payload.status.value if payload.status is not None else checkpoint.status,
            severity=payload.severity.value if payload.severity is not None else checkpoint.severity,
            notes=payload.notes if payload.notes is not None else checkpoint.notes,
            completed_by=payload.completed_by if payload.completed_by is not None else checkpoint.completed_by,
            commit=False,
        )
    except InvalidRoundTransition as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if updated is None:
        raise HTTPException(status_code=404, detail="Checkpoint not found")
    finding = None
    event_record = None
    if updated.status in {"WARNING", "FAIL"}:
        finding = create_safety_finding(
            db,
            round_id=round_id,
            checkpoint_id=checkpoint_id,
            vessel_id=round_record.vessel_id,
            title=f"{updated.name} requires attention",
            description=updated.notes or updated.description,
            location=updated.location,
            severity=updated.severity,
            created_by=updated.completed_by or "Operator",
            assigned_to=round_record.assigned_to,
            commit=False,
        )
        if previous_status != updated.status or previous_severity != updated.severity:
            event_type = "SAFETY_CHECKPOINT_FAILED" if updated.status == "FAIL" else "SAFETY_CHECKPOINT_WARNING"
            event_record = create_safety_event_record(db, vessel_id=round_record.vessel_id, event_type=event_type, title=f"{updated.name} marked {updated.status}", description=f"Checkpoint {updated.name} in {updated.location} marked {updated.status}.", severity=updated.severity, source="Safety Round", commit=False, metadata={"round_id": round_id, "checkpoint_id": checkpoint_id, "finding_id": finding.finding_id})
    db.commit()
    if finding is not None and previous_status not in {"WARNING", "FAIL"}:
        await broadcast_status_message("safety_finding_created", {"round_id": round_id, "checkpoint_id": checkpoint_id, "finding_id": finding.finding_id, "severity": finding.severity})
    if event_record is not None:
        sync_engine_from_db(db)
        await broadcast_status_message("security_event_created", {"event_id": event_record.event_id, "event_type": event_record.event_type, "severity": event_record.severity})
    await broadcast_status_message("safety_checkpoint_updated", {"round_id": round_id, "checkpoint_id": checkpoint_id, "status": updated.status, "severity": updated.severity})
    return {
        "id": updated.id,
        "checkpoint_id": updated.checkpoint_id,
        "round_id": updated.round_id,
        "status": updated.status,
        "severity": updated.severity,
        "notes": updated.notes,
        "completed_by": updated.completed_by,
    }


@app.get("/api/v1/safety-findings")
def get_safety_findings_endpoint(
    round_id: str | None = None,
    vessel_id: str | None = None,
    status: str | None = None,
    severity: str | None = None,
    assigned_to: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    findings = list_safety_findings(db, round_id=round_id, vessel_id=vessel_id, status=status, severity=severity, assigned_to=assigned_to, limit=limit, offset=offset)
    return [
        {
            "id": finding.id,
            "finding_id": finding.finding_id,
            "round_id": finding.round_id,
            "checkpoint_id": finding.checkpoint_id,
            "vessel_id": finding.vessel_id,
            "title": finding.title,
            "description": finding.description,
            "location": finding.location,
            "severity": finding.severity,
            "status": finding.status,
            "created_by": finding.created_by,
            "assigned_to": finding.assigned_to,
            "due_date": finding.due_date.isoformat() if finding.due_date else None,
            "resolution_notes": finding.resolution_notes,
            "created_at": finding.created_at.isoformat(),
            "updated_at": finding.updated_at.isoformat(),
            "resolved_at": finding.resolved_at.isoformat() if finding.resolved_at else None,
        }
        for finding in findings
    ]


@app.get("/api/v1/safety-findings/{finding_id}")
def get_safety_finding_endpoint(finding_id: str, db: Session = Depends(get_db)):
    finding = get_safety_finding(db, finding_id)
    if finding is None:
        raise HTTPException(status_code=404, detail="Safety finding not found")
    return {
        "id": finding.id,
        "finding_id": finding.finding_id,
        "round_id": finding.round_id,
        "checkpoint_id": finding.checkpoint_id,
        "vessel_id": finding.vessel_id,
        "title": finding.title,
        "description": finding.description,
        "location": finding.location,
        "severity": finding.severity,
        "status": finding.status,
        "created_by": finding.created_by,
        "assigned_to": finding.assigned_to,
        "due_date": finding.due_date.isoformat() if finding.due_date else None,
        "resolution_notes": finding.resolution_notes,
        "created_at": finding.created_at.isoformat(),
        "updated_at": finding.updated_at.isoformat(),
        "resolved_at": finding.resolved_at.isoformat() if finding.resolved_at else None,
    }


@app.post("/api/v1/safety-findings", status_code=201)
async def create_safety_finding_endpoint(payload: SafetyFindingCreate, db: Session = Depends(get_db)):
    round_record = get_safety_round(db, payload.round_id)
    if round_record is None:
        raise HTTPException(status_code=404, detail="Safety round not found")
    if round_record.status not in {"PLANNED", "IN_PROGRESS", "OVERDUE"}:
        raise HTTPException(status_code=409, detail="Cannot add findings to a closed safety round")
    if payload.vessel_id != round_record.vessel_id:
        raise HTTPException(status_code=400, detail="Finding vessel must match its safety round")
    if payload.checkpoint_id and get_safety_checkpoint(db, payload.round_id, payload.checkpoint_id) is None:
        raise HTTPException(status_code=404, detail="Checkpoint not found")
    if payload.checkpoint_id:
        existing = next(
            (
                finding
                for finding in list_safety_findings(db, round_id=payload.round_id, limit=200)
                if finding.checkpoint_id == payload.checkpoint_id and finding.status not in {"RESOLVED", "DISMISSED"}
            ),
            None,
        )
        if existing is not None:
            return finding_response(existing)
    record = create_safety_finding(
        db,
        round_id=payload.round_id,
        checkpoint_id=payload.checkpoint_id,
        vessel_id=payload.vessel_id,
        title=payload.title,
        description=payload.description,
        location=payload.location,
        severity=payload.severity.value,
        created_by=payload.created_by,
        assigned_to=payload.assigned_to,
        due_date=payload.due_date,
        resolution_notes=payload.resolution_notes,
        commit=False,
    )
    event_record = None
    if payload.severity.value in {"HIGH", "CRITICAL"}:
        event_record = create_safety_event_record(
            db,
            vessel_id=payload.vessel_id,
            event_type="SAFETY_FINDING_CREATED",
            title=payload.title,
            description=payload.description,
            severity=payload.severity.value,
            commit=False,
            metadata={"finding_id": record.finding_id, "round_id": payload.round_id, "checkpoint_id": payload.checkpoint_id},
        )
    db.commit()
    await broadcast_status_message("safety_finding_created", {"round_id": payload.round_id, "checkpoint_id": payload.checkpoint_id, "finding_id": record.finding_id, "severity": record.severity})
    if event_record is not None:
        sync_engine_from_db(db)
        await broadcast_status_message("security_event_created", {"event_id": event_record.event_id, "event_type": event_record.event_type, "severity": event_record.severity})
    return {
        "id": record.id,
        "finding_id": record.finding_id,
        "round_id": record.round_id,
        "checkpoint_id": record.checkpoint_id,
        "vessel_id": record.vessel_id,
        "title": record.title,
        "description": record.description,
        "location": record.location,
        "severity": record.severity,
        "status": record.status,
    }


@app.patch("/api/v1/safety-findings/{finding_id}")
async def update_safety_finding_endpoint(finding_id: str, payload: SafetyFindingUpdate, db: Session = Depends(get_db)):
    record = get_safety_finding(db, finding_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Safety finding not found")
    was_resolved = record.status == "RESOLVED"
    updated = update_safety_finding(
        db,
        finding_id=finding_id,
        status=payload.status.value if payload.status is not None else None,
        severity=payload.severity.value if payload.severity is not None else None,
        assigned_to=payload.assigned_to,
        due_date=payload.due_date,
        clear_due_date="due_date" in payload.model_fields_set and payload.due_date is None,
        resolution_notes=payload.resolution_notes,
        notes=payload.notes,
        commit=False,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Safety finding not found")
    event_record = None
    if updated.status == "RESOLVED" and not was_resolved:
        resolve_safety_finding_events(db, updated.finding_id)
        event_record = create_safety_event_record(
            db,
            vessel_id=updated.vessel_id,
            event_type="SAFETY_FINDING_RESOLVED",
            title=updated.title,
            description=updated.resolution_notes or updated.description,
            severity=updated.severity,
            commit=False,
            event_status="RESOLVED",
            metadata={"finding_id": updated.finding_id, "round_id": updated.round_id, "checkpoint_id": updated.checkpoint_id},
        )
    db.commit()
    await broadcast_status_message("safety_finding_updated", {"finding_id": updated.finding_id, "status": updated.status, "severity": updated.severity})
    if event_record is not None:
        sync_engine_from_db(db)
        await broadcast_status_message("security_event_created", {"event_id": event_record.event_id, "event_type": event_record.event_type, "severity": event_record.severity})
    return {
        "id": updated.id,
        "finding_id": updated.finding_id,
        "round_id": updated.round_id,
        "status": updated.status,
        "severity": updated.severity,
        "assigned_to": updated.assigned_to,
        "resolution_notes": updated.resolution_notes,
    }


@app.websocket("/ws/security")
async def websocket_security(websocket: WebSocket):
    if auth_required() and read_session(websocket.cookies.get(SESSION_COOKIE)) is None:
        await websocket.close(code=4401, reason="Not authenticated")
        return
    manager = app.state.websocket_manager
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.remove_client(websocket)
    except Exception:
        await manager.disconnect(websocket)


@app.post("/simulation/start")
@app.post("/api/v1/simulation/start")
async def start_simulation(request: ScenarioRequest, db: Session = Depends(get_db)):
    try:
        engine.start(request.scenario)
        await broadcast_status_message("simulation_status", {"scenario": engine.scenarios.name, "status": engine.scenarios.status.value, "index": engine.scenarios.index})
        await broadcast_status_message("notification", {"title": "Simulation started", "message": f"{engine.scenarios.name} started.", "severity": "INFO"})
        return {"status": engine.scenarios.status, "result": persist_tick(db)}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/simulation/tick")
@app.post("/api/v1/simulation/next")
async def next_simulation_step(db: Session = Depends(get_db)):
    return persist_tick(db)


@app.post("/api/v1/simulation/inject")
async def inject_simulation_event(payload: InjectEventRequest, db: Session = Depends(get_db)):
    try:
        result = engine.inject(payload.vessel_id, payload.event_type)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Vessel not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return persist_result(db, result, "manual-injection")


@app.post("/simulation/pause")
@app.post("/api/v1/simulation/pause")
async def simulation_pause():
    engine.pause()
    await broadcast_status_message("simulation_status", {"scenario": engine.scenarios.name, "status": engine.scenarios.status.value, "index": engine.scenarios.index})
    await broadcast_status_message("notification", {"title": "Simulation paused", "message": "The active simulation has been paused.", "severity": "INFO"})
    return simulation_status()


@app.post("/simulation/resume")
@app.post("/api/v1/simulation/resume")
async def simulation_resume():
    engine.resume()
    await broadcast_status_message("simulation_status", {"scenario": engine.scenarios.name, "status": engine.scenarios.status.value, "index": engine.scenarios.index})
    await broadcast_status_message("notification", {"title": "Simulation resumed", "message": "The active simulation has resumed.", "severity": "INFO"})
    return simulation_status()


@app.post("/simulation/stop")
@app.post("/api/v1/simulation/stop")
async def simulation_stop():
    engine.stop()
    await broadcast_status_message("simulation_status", {"scenario": engine.scenarios.name, "status": engine.scenarios.status.value, "index": engine.scenarios.index})
    await broadcast_status_message("notification", {"title": "Simulation stopped", "message": "The active simulation has been stopped.", "severity": "WARNING"})
    return simulation_status()


@app.post("/simulation/reset")
@app.post("/api/v1/simulation/reset")
async def simulation_reset():
    engine.reset()
    with SessionLocal() as db:
        resolve_all_open_events(db)
        close_open_incident_records(db, status=IncidentStatus.RESOLVED.value, note="Closed by simulation reset.")
        sync_engine_from_db(db)
    await broadcast_status_message("simulation_status", {"scenario": engine.scenarios.name, "status": engine.scenarios.status.value, "index": engine.scenarios.index})
    await broadcast_status_message("notification", {"title": "Simulation reset", "message": "The simulation has been reset.", "severity": "INFO"})
    return simulation_status()


@app.post("/simulation/scenario/{scenario_name}/start")
@app.post("/api/v1/simulation/scenario/{scenario_name}/start")
async def scenario_start(scenario_name: str, db: Session = Depends(get_db)):
    return await start_simulation(ScenarioRequest(scenario=scenario_name), db)


@app.post("/api/v1/simulation/{action}")
async def simulation_action(action: str):
    if action not in {"pause", "resume", "stop", "reset"}:
        raise HTTPException(status_code=404, detail="Unknown simulation action")
    if action == "pause":
        await simulation_pause()
    elif action == "resume":
        await simulation_resume()
    elif action == "stop":
        await simulation_stop()
    elif action == "reset":
        await simulation_reset()
    return {"scenario": engine.scenarios.name, "status": engine.scenarios.status, "index": engine.scenarios.index}
