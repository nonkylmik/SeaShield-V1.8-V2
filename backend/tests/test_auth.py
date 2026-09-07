from fastapi.testclient import TestClient

from app.main import app


def test_authentication_session_lifecycle():
    with TestClient(app) as client:
        assert client.get("/api/auth/me").status_code == 401
        invalid = client.post("/api/auth/login", json={"email": "wrong@example.com", "password": "wrong"})
        assert invalid.status_code == 401
        login = client.post("/api/auth/login", json={"email": "operator@seashield.local", "password": "seashield-demo"})
        assert login.status_code == 200
        assert login.json()["user"]["role"] == "SECURITY OPERATOR"
        assert client.get("/api/auth/me").status_code == 200
        assert client.post("/api/auth/logout").status_code == 204
        assert client.get("/api/auth/me").status_code == 401
