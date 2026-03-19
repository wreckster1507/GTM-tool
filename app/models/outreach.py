from datetime import datetime
from typing import Any, Optional
from uuid import UUID, uuid4

from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class OutreachSequenceBase(SQLModel):
    contact_id: UUID = Field(foreign_key="contacts.id", index=True)
    company_id: UUID = Field(foreign_key="companies.id", index=True)
    persona: Optional[str] = None
    status: str = "draft"  # draft | approved | sent | skipped


class OutreachSequence(OutreachSequenceBase, table=True):
    __tablename__ = "outreach_sequences"

    id: Optional[UUID] = Field(default_factory=uuid4, primary_key=True)

    # GPT-4o generated messages — stored as JSONB for easy editing
    email_1: Optional[str] = None          # initial outreach
    email_2: Optional[str] = None          # follow-up at day 3
    email_3: Optional[str] = None          # follow-up at day 7
    linkedin_message: Optional[str] = None  # connection request note

    # Subject lines
    subject_1: Optional[str] = None
    subject_2: Optional[str] = None
    subject_3: Optional[str] = None

    # Context used to generate this sequence (for audit/regen)
    generation_context: Optional[dict] = Field(
        default=None, sa_column=Column(JSONB)
    )

    generated_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class OutreachSequenceRead(OutreachSequenceBase):
    id: UUID
    email_1: Optional[str] = None
    email_2: Optional[str] = None
    email_3: Optional[str] = None
    linkedin_message: Optional[str] = None
    subject_1: Optional[str] = None
    subject_2: Optional[str] = None
    subject_3: Optional[str] = None
    generation_context: Optional[Any] = None
    generated_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
