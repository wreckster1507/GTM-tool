"""
WorkspaceSettings — single global row storing org-level configuration.

Design: there is always exactly one row (id=1). The GET endpoint creates it
with defaults on first read so migrations don't need to seed data.
"""
from __future__ import annotations

from typing import Optional
from sqlmodel import Field, SQLModel, Column
from sqlalchemy import JSON


class WorkspaceSettings(SQLModel, table=True):
    __tablename__ = "workspace_settings"

    id: int = Field(default=1, primary_key=True)

    # Outreach sequence defaults
    # e.g. [0, 3, 7] means Step 1 on Day 0, Step 2 on Day 3, Step 3 on Day 7
    outreach_step_delays: list[int] = Field(
        default=[0, 3, 7],
        sa_column=Column(JSON, nullable=False, server_default="[0, 3, 7]"),
    )


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class OutreachSettingsRead(SQLModel):
    step_delays: list[int]
    steps_count: int


class OutreachSettingsUpdate(SQLModel):
    step_delays: list[int]
