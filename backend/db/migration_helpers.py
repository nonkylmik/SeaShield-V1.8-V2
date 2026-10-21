"""Checks that let migrations 0001-0003 adopt tables created by application startup before Alembic ran.

Older SeaShield versions told users to start the backend directly, and the backend's startup creates every
missing table with `Base.metadata.create_all`. Those tables have the same definition the migrations create, so
the migrations adopt them instead of failing. Adoption only verifies existing tables and adds missing indexes;
it never drops, renames, retypes or rewrites anything.
"""
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime

import sqlalchemy as sa
from alembic import op

_FAMILIES = {int: "integer", float: "float", str: "string", datetime: "datetime", dict: "json", list: "json", bool: "boolean"}


@dataclass(frozen=True)
class ExpectedTable:
    """The table a migration would have created. Each column maps to (type family, nullable)."""

    name: str
    columns: dict[str, tuple[str, bool]]
    unique: tuple[tuple[str, ...], ...] = ()
    foreign_keys: tuple[tuple[tuple[str, ...], str, tuple[str, ...]], ...] = field(default=())


def _inspector() -> sa.engine.Inspector:
    return sa.inspect(op.get_bind())


def table_exists(table_name: str) -> bool:
    return _inspector().has_table(table_name)


def column_names(table_name: str) -> set[str]:
    return {column["name"] for column in _inspector().get_columns(table_name)}


def index_names(table_name: str) -> set[str]:
    return {index["name"] for index in _inspector().get_indexes(table_name)}


def create_index_if_missing(name: str, table_name: str, columns: list[str]) -> None:
    if name not in index_names(table_name):
        op.create_index(name, table_name, columns, unique=False)


def _family(column_type: sa.types.TypeEngine) -> str:
    # Checked by class first: SQLAlchemy 2.1 reports python_type `object` for a reflected SQLite JSON column.
    if isinstance(column_type, sa.JSON):
        return "json"
    try:
        return _FAMILIES.get(column_type.python_type, column_type.python_type.__name__)
    except NotImplementedError:
        return type(column_type).__name__.lower()


def _incompatibilities(expected: ExpectedTable) -> list[str]:
    inspector = _inspector()
    problems = []
    columns = {column["name"]: column for column in inspector.get_columns(expected.name)}
    primary_key = inspector.get_pk_constraint(expected.name).get("constrained_columns") or []
    if primary_key != ["id"]:
        problems.append(f"primary key is {primary_key}, expected ['id']")
    for name, (family, nullable) in expected.columns.items():
        column = columns.get(name)
        if column is None:
            problems.append(f"column '{name}' is missing")
            continue
        if _family(column["type"]) != family:
            problems.append(f"column '{name}' has type {column['type']}, expected a {family} column")
        if name != "id" and column["nullable"] != nullable:
            problems.append(f"column '{name}' is {'nullable' if column['nullable'] else 'NOT NULL'}, expected {'nullable' if nullable else 'NOT NULL'}")
    unique_sets = {tuple(constraint["column_names"]) for constraint in inspector.get_unique_constraints(expected.name)}
    unique_sets |= {tuple(index["column_names"]) for index in inspector.get_indexes(expected.name) if index["unique"]}
    for unique_columns in expected.unique:
        if unique_columns not in unique_sets:
            problems.append(f"no unique constraint or unique index on {list(unique_columns)}")
    foreign_keys = {
        (tuple(key["constrained_columns"]), key["referred_table"], tuple(key["referred_columns"]))
        for key in inspector.get_foreign_keys(expected.name)
    }
    for local_columns, referred_table, referred_columns in expected.foreign_keys:
        if (local_columns, referred_table, referred_columns) not in foreign_keys:
            problems.append(f"no foreign key {list(local_columns)} -> {referred_table}{list(referred_columns)}")
    return problems


def verify_existing_tables(expected_tables: Iterable[ExpectedTable]) -> set[str]:
    """Check every expected table that already exists before the migration changes anything.

    Returns the names of the tables to adopt. If any of them is incompatible, raises before the calling migration
    changes anything; changes already applied by earlier migrations in the same upgrade run are kept.
    """
    adopted, report = set(), []
    for expected in expected_tables:
        if not table_exists(expected.name):
            continue
        problems = _incompatibilities(expected)
        if problems:
            report.append(f"'{expected.name}': " + "; ".join(problems))
        adopted.add(expected.name)
    if report:
        raise RuntimeError(
            "Existing tables are not compatible with this migration, so this migration made no changes: "
            + " | ".join(report)
            + ". Earlier migrations in this upgrade, if any, remain applied (see the recorded Alembic version). "
            "These tables were not created by a known SeaShield version; restore a backup or investigate before upgrading."
        )
    return adopted
