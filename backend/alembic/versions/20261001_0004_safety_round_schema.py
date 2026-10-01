"""Merge safety-round schema variants and preserve existing records.

Revision ID: 20261001_0004
Revises: 20260906_0003
Create Date: 2026-10-01
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

from db.database import Base
from db import models

revision: str = "20261001_0004"
down_revision: str | Sequence[str] | None = "20260906_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SAFETY_TABLES = (
    models.SafetyRoundRecord.__table__,
    models.SafetyCheckpointRecord.__table__,
    models.SafetyFindingRecord.__table__,
)


def _columns(table_name: str) -> set[str]:
    return {column["name"] for column in inspect(op.get_bind()).get_columns(table_name)}


def _add_missing_columns(table_name: str, column_definitions: dict[str, sa.types.TypeEngine]) -> None:
    existing = _columns(table_name)
    for column_name, column_type in column_definitions.items():
        if column_name not in existing:
            op.add_column(table_name, sa.Column(column_name, column_type, nullable=True))
            existing.add(column_name)


def _create_missing_indexes(table_name: str, indexes: dict[str, list[str]]) -> None:
    existing = {index["name"] for index in inspect(op.get_bind()).get_indexes(table_name)}
    for index_name, column_names in indexes.items():
        if index_name not in existing:
            op.create_index(index_name, table_name, column_names, unique=False)


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind, tables=list(SAFETY_TABLES), checkfirst=True)

    _add_missing_columns(
        "safety_rounds",
        {
            "title": sa.String(length=200),
            "description": sa.Text(),
            "round_type": sa.String(length=120),
            "planned_start": sa.DateTime(timezone=True),
        },
    )
    round_columns = _columns("safety_rounds")
    round_type_source = "NULLIF(title, '')" if "title" in round_columns else "NULL"
    planned_start_source = "created_at" if "created_at" in round_columns else "CURRENT_TIMESTAMP"
    bind.execute(
        sa.text(
            "UPDATE safety_rounds "
            f"SET round_type = COALESCE(NULLIF(round_type, ''), {round_type_source}, 'General Safety Round'), "
            f"planned_start = COALESCE(planned_start, {planned_start_source}), "
            "title = COALESCE(NULLIF(title, ''), round_type), "
            "description = COALESCE(NULLIF(description, ''), notes, '')"
        )
    )
    _create_missing_indexes(
        "safety_rounds",
        {
            "ix_safety_rounds_round_type": ["round_type"],
            "ix_safety_rounds_planned_start": ["planned_start"],
        },
    )

    _add_missing_columns(
        "safety_checkpoints",
        {
            "category": sa.String(length=80),
            "sequence": sa.Integer(),
            "completed_at": sa.DateTime(timezone=True),
        },
    )
    bind.execute(sa.text("UPDATE safety_checkpoints SET category = COALESCE(category, 'General')"))
    bind.execute(sa.text("UPDATE safety_checkpoints SET sequence = COALESCE(sequence, id)"))
    _create_missing_indexes(
        "safety_checkpoints",
        {
            "ix_safety_checkpoints_sequence": ["sequence"],
            "ix_safety_checkpoints_required": ["required"],
        },
    )

    _add_missing_columns(
        "safety_findings",
        {
            "location": sa.String(length=200),
            "due_date": sa.DateTime(timezone=True),
            "resolution_notes": sa.Text(),
            "resolved_at": sa.DateTime(timezone=True),
        },
    )
    bind.execute(sa.text("UPDATE safety_findings SET location = COALESCE(location, '')"))
    bind.execute(sa.text("UPDATE safety_findings SET resolution_notes = COALESCE(resolution_notes, '')"))


def downgrade() -> None:
    raise NotImplementedError("Safety-round data is preserved; this migration is intentionally irreversible.")
