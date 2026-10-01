import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import auth
from app.main import app


@pytest.fixture()
def required_auth(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setattr(auth, "SESSION_SECRET", "test-session-secret")
    monkeypatch.setattr(auth, "PASSWORD_DIGEST", auth._digest(auth.DEMO_PASSWORD))


def test_optional_auth_config_and_protected_api(required_auth):
    with TestClient(app) as client:
        assert client.get("/api/auth/config").json() == {"auth_required": True}
        assert client.get("/health").status_code == 200
        assert client.get("/api/v1/safety-rounds").status_code == 401
        assert client.get("/api/v1/safety-rounds", headers={"Origin": "http://localhost:5173"}).headers["access-control-allow-origin"] == "http://localhost:5173"
        with pytest.raises(WebSocketDisconnect) as disconnect:
            with client.websocket_connect("/ws/security"):
                pass
        assert disconnect.value.code == 4401

        login = client.post("/api/auth/login", json={"email": auth.DEMO_EMAIL, "password": auth.DEMO_PASSWORD})
        assert login.status_code == 200
        assert client.get("/api/v1/safety-rounds").status_code == 200
        with client.websocket_connect("/ws/security"):
            assert app.state.websocket_manager.get_client_count() >= 1
