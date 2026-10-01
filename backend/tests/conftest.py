import os
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def isolate_backend_db(monkeypatch):
    """Keep tests isolated from a developer-local SQLite file."""
    db_path = Path(__file__).resolve().parents[1] / "seashield_test.db"
    monkeypatch.setenv("SEA_SHIELD_DB_PATH", str(db_path))
    if db_path.exists():
        db_path.unlink()
    yield
    if db_path.exists():
        db_path.unlink()
