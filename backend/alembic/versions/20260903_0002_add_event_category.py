"""add event category

Revision ID: 20260903_0002
Revises: 20260903_0001
Create Date: 2026-09-03
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260903_0002"
down_revision: str | Sequence[str] | None = "20260903_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
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
