"""
UserEmailConnection — per-user personal Gmail OAuth token store.

One row per connected Gmail account. A user can only have one connected
personal inbox at a time (enforced via unique constraint on user_id).

Token refresh: the Celery sync task refreshes the token on each run and
writes the updated payload back here. The `last_error` field captures the
last failure so the UI can surface "reconnect required" states.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from uuid import UUID, uuid4

from sqlalchemy import Column, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class UserEmailConnection(SQLModel, table=True):
    __tablename__ = "user_email_connections"

    id: Optional[UUID] = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True, unique=True)

    # Connected inbox address (e.g. "john@company.com")
    email_address: str = Field(index=True)

    # OAuth2 token payload: {token, refresh_token, scopes, expiry}
    token_data: dict = Field(sa_column=Column(JSONB, nullable=False))

    # Sync state
    # Unix epoch of last successful incremental sync
    last_sync_epoch: Optional[int] = Field(default=None)
    # Whether the initial historical backfill has completed
    backfill_completed: bool = Field(default=False)
    # How far back to scan on first connect (days)
    backfill_days: int = Field(default=90)

    # Health
    last_error: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    is_active: bool = Field(default=True)

    connected_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class UserEmailConnectionRead(SQLModel):
    id: UUID
    user_id: UUID
    email_address: str
    last_sync_epoch: Optional[int] = None
    backfill_completed: bool
    backfill_days: int
    last_error: Optional[str] = None
    is_active: bool
    connected_at: datetime
    updated_at: datetime


class UserEmailConnectionStatus(SQLModel):
    connected: bool
    email_address: Optional[str] = None
    last_sync_epoch: Optional[int] = None
    backfill_completed: bool = False
    last_error: Optional[str] = None
