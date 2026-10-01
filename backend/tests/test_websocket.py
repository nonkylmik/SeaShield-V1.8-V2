import asyncio

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from auth import DEMO_USER, SESSION_COOKIE, create_session
from app.main import app


def test_websocket_connects_and_broadcasts_messages():
    client = TestClient(app)
    with client.websocket_connect("/ws/security") as websocket:
        manager = app.state.websocket_manager
        assert manager.get_client_count() >= 1
        payload = {"type": "simulation_status", "data": {"status": "RUNNING"}}
        asyncio.run(manager.broadcast(payload))
        message = websocket.receive_json()
        assert message["type"] == "simulation_status"
        assert message["data"]["status"] == "RUNNING"


def test_websocket_manager_tracks_disconnects():
    manager = app.state.websocket_manager
    initial = manager.get_client_count()
    with TestClient(app).websocket_connect("/ws/security") as websocket:
        assert manager.get_client_count() == initial + 1
    assert manager.get_client_count() == initial


def test_websocket_requires_a_valid_session_when_auth_is_enabled(monkeypatch):
    monkeypatch.setattr("app.main.auth_required", lambda: True)
    client = TestClient(app)

    with pytest.raises(WebSocketDisconnect) as disconnect:
        with client.websocket_connect("/ws/security"):
            pass
    assert disconnect.value.code == 4401

    client.cookies.set(SESSION_COOKIE, create_session(DEMO_USER))
    with client.websocket_connect("/ws/security"):
        assert app.state.websocket_manager.get_client_count() >= 1
