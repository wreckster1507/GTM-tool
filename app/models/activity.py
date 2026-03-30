from datetime import datetime
from typing import Any, Optional
from uuid import UUID, uuid4

from sqlalchemy import Column, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class ActivityBase(SQLModel):
    type: str  # email, call, meeting, note, transcript, visit
    source: Optional[str] = None  # instantly, fireflies, rb2b, manual
    # Plain str here — sa_column only goes on the table class below
    content: Optional[str] = None
    ai_summary: Optional[str] = None


class Activity(ActivityBase, table=True):
    __tablename__ = "activities"

    id: Optional[UUID] = Field(default_factory=uuid4, primary_key=True)
    deal_id: Optional[UUID] = Field(default=None, foreign_key="deals.id", index=True)
    contact_id: Optional[UUID] = Field(default=None, foreign_key="contacts.id", index=True)
    # Override inherited str fields with proper Text columns
    content: Optional[str] = Field(default=None, sa_column=Column(Text))
    ai_summary: Optional[str] = Field(default=None, sa_column=Column(Text))
    event_metadata: Optional[Any] = Field(default=None, sa_column=Column("metadata", JSONB))
    created_at: datetime = Field(default_factory=datetime.utcnow)

    # Call-specific fields (populated by Aircall webhook handler)
    call_id: Optional[str] = Field(default=None, index=True)
    call_duration: Optional[int] = None        # seconds
    call_outcome: Optional[str] = None         # answered | missed | voicemail | failed
    recording_url: Optional[str] = Field(default=None, sa_column=Column("recording_url", Text))
    aircall_user_name: Optional[str] = None    # agent name from Aircall
    created_by_id: Optional[UUID] = Field(default=None, foreign_key="users.id")


class ActivityCreate(ActivityBase):
    deal_id: Optional[UUID] = None
    contact_id: Optional[UUID] = None
    event_metadata: Optional[Any] = None
    created_by_id: Optional[UUID] = None


class ActivityRead(ActivityBase):
    id: UUID
    deal_id: Optional[UUID] = None
    contact_id: Optional[UUID] = None
    event_metadata: Optional[Any] = None
    created_at: datetime
    call_id: Optional[str] = None
    call_duration: Optional[int] = None
    call_outcome: Optional[str] = None
    recording_url: Optional[str] = None
    aircall_user_name: Optional[str] = None
    created_by_id: Optional[UUID] = None
    user_name: Optional[str] = None  # joined from users table


class ActivityUpdate(SQLModel):
    type: Optional[str] = None
    source: Optional[str] = None
    content: Optional[str] = None
    ai_summary: Optional[str] = None
    deal_id: Optional[UUID] = None
    contact_id: Optional[UUID] = None
    event_metadata: Optional[Any] = None
