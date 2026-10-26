"""v1.7 persistent storage tables

Revision ID: 20260906_0003
Revises: 20260903_0002
Create Date: 2026-09-06
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from db.migration_helpers import ExpectedTable, create_index_if_missing, verify_existing_tables

revision: str = "20260906_0003"
down_revision: str | Sequence[str] | None = "20260903_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

VESSELS = ExpectedTable(
    "vessels",
    {
        "id": ("integer", False),
        "vessel_id": ("string", False),
        "name": ("string", False),
        "imo": ("string", False),
        "base_score": ("integer", False),
        "score": ("integer", False),
        "status": ("string", False),
        "last_communication": ("datetime", False),
        "created_at": ("datetime", False),
        "updated_at": ("datetime", False),
    },
    unique=(("vessel_id",),),
)
INCIDENTS = ExpectedTable(
    "incidents",
    {
        "id": ("integer", False),
        "incident_id": ("string", False),
        "vessel_id": ("string", False),
        "type": ("string", False),
        "title": ("string", False),
        "severity": ("string", False),
        "status": ("string", False),
        "description": ("string", False),
        "assigned_operator": ("string", False),
        "investigation_notes": ("string", False),
        "recommended_action": ("string", False),
        "created_at": ("datetime", False),
        "updated_at": ("datetime", False),
    },
    unique=(("incident_id",),),
)
INCIDENT_EVENT_LINKS = ExpectedTable(
    "incident_event_links",
    {
        "id": ("integer", False),
        "incident_id": ("string", False),
        "event_id": ("string", False),
        "created_at": ("datetime", False),
    },
    unique=(("incident_id", "event_id"),),
    foreign_keys=((("incident_id",), "incidents", ("incident_id",)),),
)
SECURITY_SCORE_HISTORY = ExpectedTable(
    "security_score_history",
    {
        "id": ("integer", False),
        "vessel_id": ("string", False),
        "score": ("integer", False),
        "previous_score": ("integer", True),
        "reason": ("string", True),
        "timestamp": ("datetime", False),
    },
)
SIMULATION_RUNS = ExpectedTable(
    "simulation_runs",
    {
        "id": ("integer", False),
        "scenario": ("string", False),
        "vessel_id": ("string", True),
        "start_time": ("datetime", False),
        "end_time": ("datetime", True),
        "status": ("string", False),
        "metadata": ("json", False),
    },
)


def upgrade() -> None:
    adopted = verify_existing_tables([VESSELS, INCIDENTS, INCIDENT_EVENT_LINKS, SECURITY_SCORE_HISTORY, SIMULATION_RUNS])

    if "vessels" in adopted:
        # Created earlier by application startup (create_all): keep it and add only missing indexes.
        create_index_if_missing("ix_vessels_vessel_id", "vessels", ["vessel_id"])
    else:
        op.create_table(
            "vessels",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("vessel_id", sa.String(length=100), nullable=False),
            sa.Column("name", sa.String(length=160), nullable=False),
            sa.Column("imo", sa.String(length=100), nullable=False),
            sa.Column("base_score", sa.Integer(), nullable=False, server_default="100"),
            sa.Column("score", sa.Integer(), nullable=False, server_default="100"),
            sa.Column("status", sa.String(length=30), nullable=False, server_default="SECURE"),
            sa.Column("last_communication", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("vessel_id"),
        )
        op.create_index("ix_vessels_vessel_id", "vessels", ["vessel_id"], unique=False)

    if "incidents" in adopted:
        # Created earlier by application startup (create_all): keep it and add only missing indexes.
        create_index_if_missing("ix_incidents_incident_id", "incidents", ["incident_id"])
        create_index_if_missing("ix_incidents_vessel_id", "incidents", ["vessel_id"])
        create_index_if_missing("ix_incidents_status", "incidents", ["status"])
        create_index_if_missing("ix_incidents_created_at", "incidents", ["created_at"])
    else:
        op.create_table(
            "incidents",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("incident_id", sa.String(length=100), nullable=False),
            sa.Column("vessel_id", sa.String(length=100), nullable=False),
            sa.Column("type", sa.String(length=160), nullable=False),
            sa.Column("title", sa.String(length=200), nullable=False),
            sa.Column("severity", sa.String(length=20), nullable=False),
            sa.Column("status", sa.String(length=30), nullable=False, server_default="NEW"),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("assigned_operator", sa.String(length=160), nullable=False, server_default="J. Dawson"),
            sa.Column("investigation_notes", sa.Text(), nullable=False, server_default=""),
            sa.Column("recommended_action", sa.Text(), nullable=False, server_default="Review related events and confirm containment."),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("incident_id"),
        )
        op.create_index("ix_incidents_incident_id", "incidents", ["incident_id"], unique=False)
        op.create_index("ix_incidents_vessel_id", "incidents", ["vessel_id"], unique=False)
        op.create_index("ix_incidents_status", "incidents", ["status"], unique=False)
        op.create_index("ix_incidents_created_at", "incidents", ["created_at"], unique=False)

    if "incident_event_links" in adopted:
        # Created earlier by application startup (create_all): keep it and add only missing indexes.
        create_index_if_missing("ix_incident_event_links_incident_id", "incident_event_links", ["incident_id"])
        create_index_if_missing("ix_incident_event_links_event_id", "incident_event_links", ["event_id"])
    else:
        op.create_table(
            "incident_event_links",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("incident_id", sa.String(length=100), nullable=False),
            sa.Column("event_id", sa.String(length=100), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.ForeignKeyConstraint(["incident_id"], ["incidents.incident_id"]),
            sa.UniqueConstraint("incident_id", "event_id", name="uq_incident_event_link"),
        )
        op.create_index("ix_incident_event_links_incident_id", "incident_event_links", ["incident_id"], unique=False)
        op.create_index("ix_incident_event_links_event_id", "incident_event_links", ["event_id"], unique=False)

    if "security_score_history" in adopted:
        # Created earlier by application startup (create_all): keep it and add only missing indexes.
        create_index_if_missing("ix_security_score_history_vessel_id", "security_score_history", ["vessel_id"])
        create_index_if_missing("ix_security_score_history_timestamp", "security_score_history", ["timestamp"])
    else:
        op.create_table(
            "security_score_history",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("vessel_id", sa.String(length=100), nullable=False),
            sa.Column("score", sa.Integer(), nullable=False),
            sa.Column("previous_score", sa.Integer(), nullable=True),
            sa.Column("reason", sa.String(length=200), nullable=True),
            sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_security_score_history_vessel_id", "security_score_history", ["vessel_id"], unique=False)
        op.create_index("ix_security_score_history_timestamp", "security_score_history", ["timestamp"], unique=False)

    if "simulation_runs" in adopted:
        # Created earlier by application startup (create_all): keep it and add only missing indexes.
        create_index_if_missing("ix_simulation_runs_scenario", "simulation_runs", ["scenario"])
        create_index_if_missing("ix_simulation_runs_vessel_id", "simulation_runs", ["vessel_id"])
        create_index_if_missing("ix_simulation_runs_start_time", "simulation_runs", ["start_time"])
        create_index_if_missing("ix_simulation_runs_status", "simulation_runs", ["status"])
    else:
        op.create_table(
            "simulation_runs",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("scenario", sa.String(length=100), nullable=False),
            sa.Column("vessel_id", sa.String(length=100), nullable=True),
            sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
            sa.Column("end_time", sa.DateTime(timezone=True), nullable=True),
            sa.Column("status", sa.String(length=30), nullable=False, server_default="RUNNING"),
            sa.Column("metadata", sa.JSON(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_simulation_runs_scenario", "simulation_runs", ["scenario"], unique=False)
        op.create_index("ix_simulation_runs_vessel_id", "simulation_runs", ["vessel_id"], unique=False)
        op.create_index("ix_simulation_runs_start_time", "simulation_runs", ["start_time"], unique=False)
        op.create_index("ix_simulation_runs_status", "simulation_runs", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_simulation_runs_status", table_name="simulation_runs")
    op.drop_index("ix_simulation_runs_start_time", table_name="simulation_runs")
    op.drop_index("ix_simulation_runs_vessel_id", table_name="simulation_runs")
    op.drop_index("ix_simulation_runs_scenario", table_name="simulation_runs")
    op.drop_table("simulation_runs")

    op.drop_index("ix_security_score_history_timestamp", table_name="security_score_history")
    op.drop_index("ix_security_score_history_vessel_id", table_name="security_score_history")
    op.drop_table("security_score_history")

    op.drop_index("ix_incident_event_links_event_id", table_name="incident_event_links")
    op.drop_index("ix_incident_event_links_incident_id", table_name="incident_event_links")
    op.drop_table("incident_event_links")

    op.drop_index("ix_incidents_created_at", table_name="incidents")
    op.drop_index("ix_incidents_status", table_name="incidents")
    op.drop_index("ix_incidents_vessel_id", table_name="incidents")
    op.drop_index("ix_incidents_incident_id", table_name="incidents")
    op.drop_table("incidents")

    op.drop_index("ix_vessels_vessel_id", table_name="vessels")
    op.drop_table("vessels")
