import asyncio

from fastapi.testclient import TestClient

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
