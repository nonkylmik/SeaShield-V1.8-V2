from __future__ import annotations

from typing import Any

from fastapi import WebSocket
from starlette.websockets import WebSocketState


class ConnectionManager:
    """In-memory manager for WebSocket clients."""

    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()

    def get_client_count(self) -> int:
        return len(self._clients)

    def add_client(self, websocket: WebSocket) -> None:
        self._clients.add(websocket)

    def remove_client(self, websocket: WebSocket) -> None:
        self._clients.discard(websocket)

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.add_client(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        self.remove_client(websocket)
        if websocket.application_state != WebSocketState.DISCONNECTED:
            await websocket.close()

    async def broadcast(self, message: dict[str, Any]) -> None:
        dead_clients: list[WebSocket] = []
        for client in list(self._clients):
            try:
                await client.send_json(message)
            except Exception:
                dead_clients.append(client)
        for client in dead_clients:
            self.remove_client(client)
