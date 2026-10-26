"""add event category

Revision ID: 20260903_0002
Revises: 20260903_0001
Create Date: 2026-09-03
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

from db.migration_helpers import ExpectedTable, column_names, create_index_if_missing, verify_existing_tables

revision: str = "20260903_0002"
down_revision: str | Sequence[str] | None = "20260903_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CATEGORY = ExpectedTable("security_events", {"category": ("string", False)})


def upgrade() -> None:
    if "category" in column_names("security_events"):
        # Added earlier by application startup (create_all): keep it and add only a missing index.
        verify_existing_tables([CATEGORY])
        create_index_if_missing("ix_security_events_category", "security_events", ["category"])
        return
    with op.batch_alter_table("security_events") as batch_op:
        batch_op.add_column(sa.Column("category", sa.String(length=30), nullable=True))
        batch_op.create_index("ix_security_events_category", ["category"], unique=False)
    op.execute("UPDATE security_events SET category = 'ENVIRONMENTAL' WHERE category IS NULL")
    with op.batch_alter_table("security_events") as batch_op:
        batch_op.alter_column("category", existing_type=sa.String(length=30), nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("security_events") as batch_op:
        batch_op.drop_index("ix_security_events_category")
        batch_op.drop_column("category")
