import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine

from db import models  # noqa: F401  (registers every table on Base.metadata)
from db.database import Base

BACKEND_DIR = Path(__file__).resolve().parents[1]
HEAD_REVISION = "20261021_0006"
PREVIOUS_REVISION = "20261001_0005"
INCIDENT_INDEXES_0006 = {"ix_incidents_type", "ix_incidents_severity"}

# Accepted, deferred differences between `alembic upgrade head` and `Base.metadata.create_all`:
# migration 0003 declares server-side defaults that the models only set in Python, and migration 0002
# appended security_events.category as the last column.
MIGRATION_ONLY_SERVER_DEFAULTS = {
    ("incidents", "assigned_operator"),
    ("incidents", "investigation_notes"),
    ("incidents", "recommended_action"),
    ("incidents", "status"),
    ("simulation_runs", "status"),
    ("vessels", "base_score"),
    ("vessels", "score"),
    ("vessels", "status"),
}
REORDERED_TABLES = {"security_events"}
UNIQUE_COLUMNS = {"security_events": "event_id", "vessels": "vessel_id", "incidents": "incident_id"}


def run_alembic(database_path: Path, *args: str) -> subprocess.CompletedProcess:
    # Same invocation as CI and the Docker image; DATABASE_URL points only at the temporary database.
    environment = {**os.environ, "DATABASE_URL": f"sqlite:///{database_path.as_posix()}"}
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_DIR,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )


def upgrade(database_path: Path, revision: str = "head") -> None:
    result = run_alembic(database_path, "upgrade", revision)
    assert result.returncode == 0, result.stderr


def read_schema(database_path: Path) -> dict:
    connection = sqlite3.connect(database_path)
    try:
        schema = {}
        tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")]
        for table in tables:
            columns = [row[1:6] for row in connection.execute(f"PRAGMA table_info('{table}')")]
            indexes = set()
            for _, name, unique, origin, _ in connection.execute(f"PRAGMA index_list('{table}')"):
                index_columns = tuple(row[2] for row in connection.execute(f"PRAGMA index_info('{name}')"))
                indexes.add((name if origin == "c" else None, index_columns, unique, origin))
            schema[table] = {"columns": columns, "indexes": indexes}
        return schema
    finally:
        connection.close()


def read_rows(database_path: Path) -> dict:
    connection = sqlite3.connect(database_path)
    try:
        tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'alembic_version'")]
        return {table: sorted(connection.execute(f"SELECT * FROM {table}").fetchall(), key=repr) for table in tables}
    finally:
        connection.close()


def insert_sample_rows(database_path: Path) -> None:
    connection = sqlite3.connect(database_path)
    try:
        timestamp = "2026-10-21 10:00:00.000000"
        connection.execute(
            "INSERT INTO security_events (event_id, timestamp, event_type, category, severity, source, description, status, vessel_id, metadata, created_at) "
            "VALUES ('EVT-1', ?, 'FIRE_ALARM', 'ENVIRONMENTAL', 'CRITICAL', 'Fire Panel', 'Simulated fire alarm.', 'OPEN', 'calypso', '{}', ?)",
            (timestamp, timestamp),
        )
        connection.execute(
            "INSERT INTO vessels (vessel_id, name, imo, base_score, score, status, last_communication, created_at, updated_at) "
            "VALUES ('calypso', 'MV Calypso', 'IMO 9751028', 92, 72, 'WARNING', ?, ?, ?)",
            (timestamp, timestamp, timestamp),
        )
        connection.execute(
            "INSERT INTO incidents (incident_id, vessel_id, type, title, severity, status, description, assigned_operator, investigation_notes, recommended_action, created_at, updated_at) "
            "VALUES ('INC-0241', 'calypso', 'Fire/Environmental Emergency', 'Fire', 'CRITICAL', 'NEW', 'Simulated.', 'J. Dawson', '', 'Contain.', ?, ?)",
            (timestamp, timestamp),
        )
        connection.execute("INSERT INTO incident_event_links (incident_id, event_id, created_at) VALUES ('INC-0241', 'EVT-1', ?)", (timestamp,))
        connection.commit()
    finally:
        connection.close()


def incident_index_names(database_path: Path) -> set[str]:
    return {name for name, *_ in read_schema(database_path)["incidents"]["indexes"] if name}


def test_fresh_upgrade_reaches_head_and_alembic_check_is_clean(tmp_path):
    database_path = tmp_path / "fresh.db"
    upgrade(database_path)

    current = run_alembic(database_path, "current")
    assert HEAD_REVISION in current.stdout
    check = run_alembic(database_path, "check")
    assert check.returncode == 0, check.stdout + check.stderr
    assert "No new upgrade operations detected" in check.stdout + check.stderr
    assert INCIDENT_INDEXES_0006 <= incident_index_names(database_path)


def test_migrated_schema_matches_models_except_deferred_differences(tmp_path):
    migrated_path = tmp_path / "migrated.db"
    upgrade(migrated_path)
    model_path = tmp_path / "models.db"
    model_engine = create_engine(f"sqlite:///{model_path.as_posix()}")
    Base.metadata.create_all(model_engine)
    model_engine.dispose()

    migrated, from_models = read_schema(migrated_path), read_schema(model_path)
    assert set(migrated) - set(from_models) == {"alembic_version"}
    assert set(from_models) - set(migrated) == set()

    default_differences = set()
    for table, model_table in from_models.items():
        migrated_columns = {column[0]: column for column in migrated[table]["columns"]}
        model_columns = {column[0]: column for column in model_table["columns"]}
        assert set(migrated_columns) == set(model_columns), table
        for name, (_, column_type, not_null, default, primary_key) in model_columns.items():
            migrated_type, migrated_not_null, migrated_default, migrated_primary_key = migrated_columns[name][1:]
            assert (migrated_type, migrated_not_null, migrated_primary_key) == (column_type, not_null, primary_key), f"{table}.{name}"
            if migrated_default != default:
                default_differences.add((table, name))
        if table not in REORDERED_TABLES:
            assert list(migrated_columns) == list(model_columns), table
        assert migrated[table]["indexes"] == model_table["indexes"], table

    assert default_differences == MIGRATION_ONLY_SERVER_DEFAULTS


@pytest.mark.parametrize("table,column", sorted(UNIQUE_COLUMNS.items()))
def test_unique_columns_use_a_constraint_and_reject_duplicates(tmp_path, table, column):
    database_path = tmp_path / "unique.db"
    upgrade(database_path)
    insert_sample_rows(database_path)

    indexes = read_schema(database_path)[table]["indexes"]
    assert (None, (column,), 1, "u") in indexes  # table-level UNIQUE constraint enforces uniqueness
    assert (f"ix_{table}_{column}", (column,), 0, "c") in indexes  # plain lookup index

    connection = sqlite3.connect(database_path)
    try:
        row = connection.execute(f"SELECT * FROM {table} LIMIT 1").fetchone()
        names = [description[0] for description in connection.execute(f"SELECT * FROM {table} LIMIT 1").description]
        values = dict(zip(names, row))
        values.pop("id")
        with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
            connection.execute(f"INSERT INTO {table} ({', '.join(values)}) VALUES ({', '.join('?' * len(values))})", list(values.values()))
    finally:
        connection.close()


def test_incident_index_migration_round_trip_preserves_data(tmp_path):
    database_path = tmp_path / "round_trip.db"
    upgrade(database_path)
    insert_sample_rows(database_path)
    schema_at_head, rows_at_head = read_schema(database_path), read_rows(database_path)
    assert INCIDENT_INDEXES_0006 <= incident_index_names(database_path)

    downgrade = run_alembic(database_path, "downgrade", PREVIOUS_REVISION)
    assert downgrade.returncode == 0, downgrade.stderr
    assert incident_index_names(database_path).isdisjoint(INCIDENT_INDEXES_0006)
    assert read_rows(database_path) == rows_at_head

    upgrade(database_path)
    assert read_schema(database_path) == schema_at_head
    assert read_rows(database_path) == rows_at_head


def test_incident_index_migration_keeps_indexes_that_already_exist(tmp_path):
    database_path = tmp_path / "existing_index.db"
    upgrade(database_path, PREVIOUS_REVISION)
    connection = sqlite3.connect(database_path)
    try:
        connection.execute("CREATE INDEX ix_incidents_type ON incidents (type)")
        connection.commit()
    finally:
        connection.close()

    upgrade(database_path)

    indexes = read_schema(database_path)["incidents"]["indexes"]
    assert sum(1 for name, *_ in indexes if name == "ix_incidents_type") == 1
    assert INCIDENT_INDEXES_0006 <= incident_index_names(database_path)
