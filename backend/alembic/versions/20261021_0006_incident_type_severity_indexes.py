"""Add the incident type and severity indexes declared by the models.

Revision ID: 20261021_0006
Revises: 20261001_0005
Create Date: 2026-10-21
"""
from collections.abc import Sequence

from alembic import op
from sqlalchemy import inspect

revision: str = "20261021_0006"
down_revision: str | Sequence[str] | None = "20261001_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INDEXES = {
    "ix_incidents_type": ["type"],
    "ix_incidents_severity": ["severity"],
}


def _incident_index_names() -> set[str]:
    return {index["name"] for index in inspect(op.get_bind()).get_indexes("incidents")}


def upgrade() -> None:
    # Databases first created by application startup (create_all) already have these indexes.
    existing = _incident_index_names()
    for index_name, column_names in INDEXES.items():
        if index_name not in existing:
            op.create_index(index_name, "incidents", column_names, unique=False)


def downgrade() -> None:
    existing = _incident_index_names()
    for index_name in reversed(INDEXES):
        if index_name in existing:
            op.drop_index(index_name, table_name="incidents")
