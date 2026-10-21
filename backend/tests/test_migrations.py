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


# --- Existing databases created by earlier SeaShield versions (fixtures/migrations/*.sql) -------------------

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures" / "migrations"

# Differences that remain after upgrading an older database, deferred to later stages. Tables created by
# application startup have no server-side defaults and a unique index instead of constraint + index; safety
# tables first created by d64be3a or cc93f8c keep their original nullability, VARCHAR lengths and indexes.
STARTUP_DEFAULTS = {("server_default", table, column) for table, column in MIGRATION_ONLY_SERVER_DEFAULTS}
STARTUP_UNIQUE_INDEXES = {("index_shape", "incidents", "incident_id"), ("index_shape", "vessels", "vessel_id")}
STARTUP_SECURITY_EVENTS = {("index_shape", "security_events", "event_id")}
D64BE3A_SAFETY = {("nullability", "safety_rounds", "description")}
CC93F8C_SAFETY = {
    ("nullability", "safety_checkpoints", "category"),
    ("nullability", "safety_checkpoints", "notes"),
    ("nullability", "safety_checkpoints", "sequence"),
    ("nullability", "safety_findings", "assigned_to"),
    ("nullability", "safety_findings", "location"),
    ("nullability", "safety_findings", "resolution_notes"),
    ("nullability", "safety_rounds", "planned_start"),
    ("nullability", "safety_rounds", "round_type"),
    ("nullability", "safety_rounds", "title"),
    ("type", "safety_checkpoints", "checkpoint_id"),
    ("type", "safety_findings", "checkpoint_id"),
    ("type", "safety_findings", "finding_id"),
    ("missing_index", "safety_checkpoints", "created_at"),
    ("missing_index", "safety_rounds", "assigned_to"),
}
HISTORICAL_FIXTURES = {
    "tracked_0003_96622fb": set(),
    "tracked_0003_d64be3a": D64BE3A_SAFETY,
    "tracked_0003_cc93f8c": D64BE3A_SAFETY,
    "tracked_0004_c70d429": D64BE3A_SAFETY,
    "tracked_0005_88872b3": set(),
    "unversioned_96622fb": STARTUP_DEFAULTS | STARTUP_UNIQUE_INDEXES | STARTUP_SECURITY_EVENTS,
    "unversioned_d64be3a_to_88872b3": STARTUP_DEFAULTS | STARTUP_UNIQUE_INDEXES | STARTUP_SECURITY_EVENTS | D64BE3A_SAFETY,
    "unversioned_cc93f8c_to_88872b3": STARTUP_DEFAULTS | STARTUP_UNIQUE_INDEXES | STARTUP_SECURITY_EVENTS | CC93F8C_SAFETY,
    "unversioned_88872b3": STARTUP_DEFAULTS | STARTUP_UNIQUE_INDEXES | STARTUP_SECURITY_EVENTS,
    "committed_96622fb": STARTUP_DEFAULTS | STARTUP_UNIQUE_INDEXES,
    "committed_d64be3a": STARTUP_DEFAULTS | STARTUP_UNIQUE_INDEXES | D64BE3A_SAFETY,
    "committed_cc93f8c": STARTUP_DEFAULTS | STARTUP_UNIQUE_INDEXES | CC93F8C_SAFETY,
}

APP_SMOKE_TEST = """
import app.main as main
from fastapi.testclient import TestClient
with TestClient(main.app) as client:
    created = client.post('/api/v1/safety-rounds', json={'vessel_id': 'calypso', 'round_type': 'Security Round'})
    assert created.status_code == 201, created.text
    assert client.post(f"/api/v1/safety-rounds/{created.json()['round_id']}/start").status_code == 200
    assert client.post('/api/v1/simulation/inject', json={'vessel_id': 'calypso', 'event_type': 'FIRE_ALARM'}).status_code == 200
    assert client.get('/api/v1/incidents').status_code == 200
    assert client.get('/api/v1/safety-findings').status_code == 200
"""


def load_fixture(name: str, database_path: Path) -> None:
    connection = sqlite3.connect(database_path)
    try:
        connection.executescript((FIXTURES_DIR / f"{name}.sql").read_text(encoding="utf-8"))
    finally:
        connection.close()


def rows_by_id(database_path: Path) -> dict:
    connection = sqlite3.connect(database_path)
    try:
        tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'alembic_version'")]
        result = {}
        for table in tables:
            cursor = connection.execute(f"SELECT * FROM {table}")
            names = [description[0] for description in cursor.description]
            result[table] = {row[0]: dict(zip(names, row)) for row in cursor.fetchall()}
        return result
    finally:
        connection.close()


def changed_values(before: dict, after: dict) -> list[tuple]:
    changes = []
    for table, rows in before.items():
        for row_id, row in rows.items():
            new_row = after.get(table, {}).get(row_id)
            if new_row is None:
                changes.append((table, row_id, "<row removed>", None, None))
                continue
            changes.extend((table, row_id, column, value, new_row.get(column)) for column, value in row.items() if new_row.get(column) != value)
    return changes


def is_safety_round_description_backfill(change: tuple, before: dict) -> bool:
    # Migration 0004 fills an empty round description from the round's notes. No SeaShield version creates
    # rounds in that state (each stores `description or notes`), so this only affects hand-edited data.
    table, row_id, column, old, new = change
    notes = before.get("safety_rounds", {}).get(row_id, {}).get("notes")
    return table == "safety_rounds" and column == "description" and old == "" and bool(notes) and new == notes


def schema_drift(reference: dict, upgraded: dict) -> set[tuple]:
    drift = set()
    for table, reference_table in reference.items():
        if table not in upgraded:
            drift.add(("missing_table", table, ""))
            continue
        columns = {column[0]: column for column in upgraded[table]["columns"]}
        for name, column_type, not_null, default, _ in reference_table["columns"]:
            if name not in columns:
                drift.add(("missing_column", table, name))
                continue
            if columns[name][1] != column_type:
                drift.add(("type", table, name))
            if columns[name][2] != not_null:
                drift.add(("nullability", table, name))
            if columns[name][3] != default:
                drift.add(("server_default", table, name))
        reference_indexes = {(index[1], index[2]) for index in reference_table["indexes"]}
        upgraded_indexes = {(index[1], index[2]) for index in upgraded[table]["indexes"]}
        upgraded_columns = {columns_ for columns_, _ in upgraded_indexes}
        for index_columns, _ in reference_indexes - upgraded_indexes:
            drift.add(("index_shape" if index_columns in upgraded_columns else "missing_index", table, ",".join(index_columns)))
    return drift


def database_content(database_path: Path) -> list[str]:
    connection = sqlite3.connect(database_path)
    try:
        return [line for line in connection.iterdump() if "alembic_version" not in line]
    finally:
        connection.close()


def alembic_versions(database_path: Path) -> list[str]:
    connection = sqlite3.connect(database_path)
    try:
        if not connection.execute("SELECT count(*) FROM sqlite_master WHERE name = 'alembic_version'").fetchone()[0]:
            return []
        return [row[0] for row in connection.execute("SELECT version_num FROM alembic_version")]
    finally:
        connection.close()


@pytest.fixture(scope="module")
def fresh_head_schema(tmp_path_factory) -> dict:
    database_path = tmp_path_factory.mktemp("reference") / "fresh.db"
    upgrade(database_path)
    return read_schema(database_path)


@pytest.mark.parametrize("fixture_name", sorted(HISTORICAL_FIXTURES))
def test_historical_database_upgrades_without_losing_data(tmp_path, fresh_head_schema, fixture_name):
    database_path = tmp_path / f"{fixture_name}.db"
    load_fixture(fixture_name, database_path)
    before = rows_by_id(database_path)

    upgrade(database_path)

    assert alembic_versions(database_path) == [HEAD_REVISION]
    after = rows_by_id(database_path)
    unexpected = [change for change in changed_values(before, after) if not is_safety_round_description_backfill(change, before)]
    assert unexpected == []
    connection = sqlite3.connect(database_path)
    try:
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        connection.close()

    upgraded_schema = read_schema(database_path)
    assert schema_drift(fresh_head_schema, upgraded_schema) == HISTORICAL_FIXTURES[fixture_name]
    for table, column in UNIQUE_COLUMNS.items():
        assert any(columns == (column,) and unique for _, columns, unique, _ in upgraded_schema[table]["indexes"]), table

    # Application startup's create_all must find nothing left to create.
    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    Base.metadata.create_all(engine)
    engine.dispose()
    assert read_schema(database_path) == upgraded_schema

    smoke = subprocess.run(
        [sys.executable, "-c", APP_SMOKE_TEST],
        cwd=BACKEND_DIR,
        env={**os.environ, "DATABASE_URL": f"sqlite:///{database_path.as_posix()}"},
        capture_output=True,
        text=True,
        check=False,
    )
    assert smoke.returncode == 0, smoke.stderr[-2000:]


def insert_orphaned_finding(database_path: Path) -> None:
    connection = sqlite3.connect(database_path)
    try:
        connection.execute(
            "INSERT INTO safety_findings (finding_id, round_id, checkpoint_id, vessel_id, title, description, location, severity, status, created_by, assigned_to, resolution_notes, created_at, updated_at) "
            "SELECT 'FND-ORPHAN', round_id, 'CP-DOES-NOT-EXIST', vessel_id, 'Orphaned finding', '', '', 'LOW', 'OPEN', 'Operator', 'Operator', '', created_at, updated_at FROM safety_rounds LIMIT 1"
        )
        connection.commit()
    finally:
        connection.close()


def test_orphaned_finding_stops_upgrade_until_an_operator_fixes_it(tmp_path):
    database_path = tmp_path / "orphan.db"
    load_fixture("tracked_0004_c70d429", database_path)
    insert_orphaned_finding(database_path)
    content_before = database_content(database_path)

    result = run_alembic(database_path, "upgrade", "head")

    assert result.returncode != 0
    assert "1 orphaned references exist" in result.stdout + result.stderr
    assert alembic_versions(database_path) == ["20261001_0004"]
    assert any("FND-ORPHAN" in line for line in database_content(database_path))
    assert [line for line in database_content(database_path) if line.startswith("INSERT")] == [line for line in content_before if line.startswith("INSERT")]

    connection = sqlite3.connect(database_path)
    try:
        connection.execute("UPDATE safety_findings SET checkpoint_id = NULL WHERE finding_id = 'FND-ORPHAN'")
        connection.commit()
    finally:
        connection.close()
    upgrade(database_path)
    assert alembic_versions(database_path) == [HEAD_REVISION]


def test_orphaned_finding_is_left_untouched_when_the_foreign_key_already_exists(tmp_path):
    # Databases created by 88872b3's startup already have the foreign key, so migration 0005 has nothing to add.
    database_path = tmp_path / "orphan_with_key.db"
    load_fixture("unversioned_88872b3", database_path)
    insert_orphaned_finding(database_path)
    before = rows_by_id(database_path)

    upgrade(database_path)

    after = rows_by_id(database_path)
    assert [change for change in changed_values(before, after) if not is_safety_round_description_backfill(change, before)] == []
    connection = sqlite3.connect(database_path)
    try:
        violations = connection.execute("PRAGMA foreign_key_check('safety_findings')").fetchall()
    finally:
        connection.close()
    assert len(violations) == 1


def recreate_table(connection: sqlite3.Connection, table: str, create_sql: str) -> None:
    original_columns = [row[1] for row in connection.execute(f"PRAGMA table_info('{table}')")]
    connection.execute(f"ALTER TABLE {table} RENAME TO {table}_original")
    connection.execute(create_sql)
    new_columns = {row[1] for row in connection.execute(f"PRAGMA table_info('{table}')")}
    columns = ", ".join(column for column in original_columns if column in new_columns)
    connection.execute(f"INSERT INTO {table} ({columns}) SELECT {columns} FROM {table}_original")
    connection.execute(f"DROP TABLE {table}_original")


SECURITY_EVENTS_COLUMNS = (
    "id INTEGER NOT NULL PRIMARY KEY, event_id VARCHAR(100) NOT NULL UNIQUE, timestamp DATETIME NOT NULL, event_type VARCHAR(100) NOT NULL, "
    "category VARCHAR(30) NOT NULL, severity VARCHAR(20) NOT NULL, source VARCHAR(160) NOT NULL, title VARCHAR(200), description TEXT NOT NULL, "
    "status VARCHAR(20) NOT NULL, confidence FLOAT, scenario VARCHAR(100), vessel_id VARCHAR(100) NOT NULL, metadata JSON NOT NULL, created_at DATETIME NOT NULL"
)
UNSUPPORTED_SCHEMAS = {
    "missing_columns": (
        "unversioned_88872b3", "security_events",
        f"CREATE TABLE security_events ({SECURITY_EVENTS_COLUMNS.replace(', confidence FLOAT, scenario VARCHAR(100)', '')})",
        "column 'confidence' is missing",
    ),
    "incompatible_type": (
        "unversioned_88872b3", "security_events",
        f"CREATE TABLE security_events ({SECURITY_EVENTS_COLUMNS.replace('confidence FLOAT', 'confidence TEXT')})",
        "column 'confidence' has type TEXT, expected a float column",
    ),
    "incompatible_nullability": (
        "unversioned_88872b3", "security_events",
        f"CREATE TABLE security_events ({SECURITY_EVENTS_COLUMNS.replace('description TEXT NOT NULL', 'description TEXT')})",
        "column 'description' is nullable, expected NOT NULL",
    ),
    "missing_unique_key": (
        "committed_96622fb", "vessels",
        "CREATE TABLE vessels (id INTEGER NOT NULL PRIMARY KEY, vessel_id VARCHAR(100) NOT NULL, name VARCHAR(160) NOT NULL, imo VARCHAR(100) NOT NULL, "
        "base_score INTEGER NOT NULL, score INTEGER NOT NULL, status VARCHAR(30) NOT NULL, last_communication DATETIME NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL)",
        "no unique constraint or unique index on ['vessel_id']",
    ),
    "missing_foreign_key": (
        "committed_96622fb", "incident_event_links",
        "CREATE TABLE incident_event_links (id INTEGER NOT NULL PRIMARY KEY, incident_id VARCHAR(100) NOT NULL, event_id VARCHAR(100) NOT NULL, "
        "created_at DATETIME NOT NULL, CONSTRAINT uq_incident_event_link UNIQUE (incident_id, event_id))",
        "no foreign key ['incident_id'] -> incidents['incident_id']",
    ),
}


@pytest.mark.parametrize("case", sorted(UNSUPPORTED_SCHEMAS))
def test_incompatible_existing_table_stops_its_migration_before_it_changes_anything(tmp_path, case):
    # Only the rejecting migration is guaranteed to make no changes. In these cases it is also the first migration
    # of the run (0001 for the unversioned fixture, 0003 for the fixture at 0002), so the whole database must be
    # unchanged. When earlier migrations succeed first, their changes remain and the recorded version shows them.
    fixture_name, table, create_sql, expected_problem = UNSUPPORTED_SCHEMAS[case]
    database_path = tmp_path / f"{case}.db"
    load_fixture(fixture_name, database_path)
    connection = sqlite3.connect(database_path)
    try:
        recreate_table(connection, table, create_sql)
        connection.commit()
    finally:
        connection.close()
    versions_before, content_before = alembic_versions(database_path), database_content(database_path)

    result = run_alembic(database_path, "upgrade", "head")

    output = result.stdout + result.stderr
    assert result.returncode != 0
    assert f"'{table}'" in output and expected_problem in output and "this migration made no changes" in output
    assert alembic_versions(database_path) == versions_before
    assert database_content(database_path) == content_before


def test_extra_user_column_is_kept(tmp_path):
    database_path = tmp_path / "extra_column.db"
    load_fixture("unversioned_88872b3", database_path)
    connection = sqlite3.connect(database_path)
    try:
        connection.execute("ALTER TABLE vessels ADD COLUMN local_note TEXT")
        connection.execute("UPDATE vessels SET local_note = 'kept by the upgrade'")
        connection.commit()
    finally:
        connection.close()

    upgrade(database_path)

    connection = sqlite3.connect(database_path)
    try:
        assert connection.execute("SELECT local_note FROM vessels").fetchall() == [("kept by the upgrade",)]
    finally:
        connection.close()


def test_partly_existing_database_creates_only_the_missing_tables(tmp_path, fresh_head_schema):
    database_path = tmp_path / "partial.db"
    load_fixture("unversioned_96622fb", database_path)
    connection = sqlite3.connect(database_path)
    try:
        connection.execute("DROP TABLE simulation_runs")
        connection.execute("DROP TABLE security_score_history")
        connection.commit()
    finally:
        connection.close()
    before = rows_by_id(database_path)

    upgrade(database_path)

    assert alembic_versions(database_path) == [HEAD_REVISION]
    assert changed_values(before, rows_by_id(database_path)) == []
    upgraded = read_schema(database_path)
    for table in ("simulation_runs", "security_score_history"):
        assert upgraded[table] == fresh_head_schema[table]
