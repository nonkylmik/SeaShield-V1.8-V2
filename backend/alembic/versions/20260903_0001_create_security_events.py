"""create security events table

Revision ID: 20260903_0001
Revises:
Create Date: 2026-09-03
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260903_0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "security_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("event_id", sa.String(length=100), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("severity", sa.String(length=20), nullable=False),
        sa.Column("source", sa.String(length=160), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("scenario", sa.String(length=100), nullable=True),
        sa.Column("vessel_id", sa.String(length=100), nullable=False),
        sa.Column("metadata", sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id"),
    )
    op.create_index("ix_security_events_event_id", "security_events", ["event_id"], unique=False)
    op.create_index("ix_security_events_timestamp", "security_events", ["timestamp"], unique=False)
    op.create_index("ix_security_events_event_type", "security_events", ["event_type"], unique=False)
    op.create_index("ix_security_events_severity", "security_events", ["severity"], unique=False)
    op.create_index("ix_security_events_scenario", "security_events", ["scenario"], unique=False)
    op.create_index("ix_security_events_vessel_id", "security_events", ["vessel_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_security_events_vessel_id", table_name="security_events")
    op.drop_index("ix_security_events_scenario", table_name="security_events")
    op.drop_index("ix_security_events_severity", table_name="security_events")
    op.drop_index("ix_security_events_event_type", table_name="security_events")
    op.drop_index("ix_security_events_timestamp", table_name="security_events")
    op.drop_index("ix_security_events_event_id", table_name="security_events")
    op.drop_table("security_events")
