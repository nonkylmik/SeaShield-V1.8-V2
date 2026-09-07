import base64
import hashlib
import hmac
import os
import secrets
import time
from dataclasses import dataclass

SESSION_COOKIE = "seashield_session"
SESSION_TTL_SECONDS = 8 * 60 * 60
SESSION_SECRET = os.getenv("SESSION_SECRET", "change-me-in-development")
DEMO_EMAIL = os.getenv("DEMO_USER_EMAIL", "operator@seashield.local")
DEMO_PASSWORD = os.getenv("DEMO_USER_PASSWORD", "seashield-demo")


@dataclass(frozen=True)
class User:
    email: str
    name: str
    role: str


DEMO_USER = User(email=DEMO_EMAIL, name="J. Dawson", role="SECURITY OPERATOR")


def _digest(value: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", value.encode(), SESSION_SECRET.encode(), 120_000).hex()


PASSWORD_DIGEST = _digest(DEMO_PASSWORD)


def authenticate(email: str, password: str) -> User | None:
    if not hmac.compare_digest(email.strip().lower(), DEMO_USER.email.lower()):
        return None
    if not hmac.compare_digest(_digest(password), PASSWORD_DIGEST):
        return None
    return DEMO_USER


def create_session(user: User) -> str:
    expires = str(int(time.time()) + SESSION_TTL_SECONDS)
    payload = f"{user.email}|{expires}|{secrets.token_urlsafe(12)}"
    signature = hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{payload}|{signature}".encode()).decode()


def read_session(token: str | None) -> User | None:
    if not token:
        return None
    try:
        decoded = base64.urlsafe_b64decode(token.encode()).decode()
        email, expires, nonce, signature = decoded.split("|", 3)
    except (ValueError, UnicodeDecodeError, base64.binascii.Error):
        return None
    payload = f"{email}|{expires}|{nonce}"
    expected = hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected) or int(expires) < int(time.time()):
        return None
    return DEMO_USER if hmac.compare_digest(email.lower(), DEMO_USER.email.lower()) else None
