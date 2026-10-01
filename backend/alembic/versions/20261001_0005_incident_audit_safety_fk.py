"""Create incident audit tables and tighten safety finding references.

Revision ID: 20261001_0005
Revises: 20261001_0004
Create Date: 2026-10-01
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

from db import models
from db.database import Base

revision: str = "20261001_0005"
down_revision: str | Sequence[str] | None = "20261001_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

AUDIT_TABLES = (
    models.IncidentNoteRecord.__table__,
    models.IncidentActivityRecord.__table__,
    models.EventAcknowledgementRecord.__table__,
)


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind, tables=list(AUDIT_TABLES), checkfirst=True)

    foreign_keys = inspect(bind).get_foreign_keys("safety_findings")
    has_checkpoint_fk = any(
        key.get("constrained_columns") == ["checkpoint_id"]
        and key.get("referred_table") == "safety_checkpoints"
        for key in foreign_keys
    )
    if not has_checkpoint_fk:
        orphan_count = bind.scalar(
            sa.text(
                "SELECT COUNT(*) FROM safety_findings f "
                "LEFT JOIN safety_checkpoints c ON c.checkpoint_id = f.checkpoint_id "
                "WHERE f.checkpoint_id IS NOT NULL AND c.checkpoint_id IS NULL"
            )
        )
        if orphan_count:
            raise RuntimeError(
                f"Cannot add safety finding checkpoint foreign key: {orphan_count} orphaned references exist"
            )
        with op.batch_alter_table("safety_findings") as batch:
            batch.create_foreign_key(
                "fk_safety_findings_checkpoint_id",
                "safety_checkpoints",
                ["checkpoint_id"],
                ["checkpoint_id"],
            )


def downgrade() -> None:
    bind = op.get_bind()
    foreign_keys = inspect(bind).get_foreign_keys("safety_findings")
    checkpoint_fk = next(
        (
            key
            for key in foreign_keys
            if key.get("name") == "fk_safety_findings_checkpoint_id"
        ),
        None,
    )
    if checkpoint_fk:
        with op.batch_alter_table("safety_findings") as batch:
            batch.drop_constraint("fk_safety_findings_checkpoint_id", type_="foreignkey")
