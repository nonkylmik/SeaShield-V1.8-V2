"""Canonical vessel security status: the only place a security score is classified.

A vessel's status is derived from its security score (0-100) and nothing else. Severity (INFO-CRITICAL) classifies
individual events, incidents and safety findings and affects a vessel's status only through score penalties.
"""
from decimal import Decimal
from enum import Enum


class SecurityStatus(str, Enum):
    SECURE = "SECURE"
    ELEVATED = "ELEVATED"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"


# Lowest score of each status, most secure first.
STATUS_BANDS: tuple[tuple[int, SecurityStatus], ...] = (
    (86, SecurityStatus.SECURE),
    (72, SecurityStatus.ELEVATED),
    (55, SecurityStatus.WARNING),
    (0, SecurityStatus.CRITICAL),
)


def status_for_score(score: int) -> str:
    for minimum, status in STATUS_BANDS:
        if score >= minimum:
            return status.value
    return SecurityStatus.CRITICAL.value


def average_score(scores: list[int]) -> int | None:
    """Mean score rounded half up (as the UI displays it), or None for no vessels."""
    if not scores:
        return None
    return int(Decimal(sum(scores)) / Decimal(len(scores)) + Decimal("0.5"))
