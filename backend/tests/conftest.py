import os
import os
from pathlib import Path

import pytest

TEST_DATABASE_PATH = Path(__file__).resolve().parents[1] / "seashield_test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DATABASE_PATH.as_posix()}"

from db.database import engine


@pytest.fixture(scope="session", autouse=True)
def isolate_backend_db():
    engine.dispose()
    TEST_DATABASE_PATH.unlink(missing_ok=True)
    yield
    engine.dispose()
    TEST_DATABASE_PATH.unlink(missing_ok=True)
