from datetime import datetime
from typing import Any, Optional
from uuid import UUID, uuid4

from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class ContactBase(SQLModel):
    first_name: str
    last_name: str
    email: Optional[str] = Field(default=None, index=True)
    email_verified: bool = False
    phone: Optional[str] = Field(default=None, index=True)
    title: Optional[str] = None
    seniority: Optional[str] = None
    linkedin_url: Optional[str] = None
    persona: Optional[str] = Field(default=None, index=True)


class Contact(ContactBase, table=True):
    __tablename__ = "contacts"

    id: Optional[UUID] = Field(default_factory=uuid4, primary_key=True)
    company_id: Optional[UUID] = Field(default=None, foreign_key="companies.id", index=True)
    # Account sourcing enrichment fields
    enriched_at: Optional[datetime] = None
    enrichment_data: Optional[Any] = Field(default=None, sa_column=Column(JSONB))
    persona_type: Optional[str] = None  # champion | buyer | evaluator | blocker
    assigned_to_id: Optional[UUID] = Field(default=None, foreign_key="users.id", index=True)  # AE
    assigned_rep_email: Optional[str] = None
    sdr_id: Optional[UUID] = Field(default=None, index=True)  # SDR
    sdr_name: Optional[str] = None
    outreach_lane: Optional[str] = Field(default=None, index=True)
    sequence_status: Optional[str] = Field(default=None, index=True)
    instantly_status: Optional[str] = None
    instantly_campaign_id: Optional[str] = None
    warm_intro_strength: Optional[int] = None
    warm_intro_path: Optional[Any] = Field(default=None, sa_column=Column(JSONB))
    conversation_starter: Optional[str] = None
    personalization_notes: Optional[str] = None
    talking_points: Optional[Any] = Field(default=None, sa_column=Column(JSONB))
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ContactCreate(ContactBase):
    company_id: Optional[UUID] = None
    persona_type: Optional[str] = None


class ContactRead(ContactBase):
    id: UUID
    company_id: Optional[UUID] = None
    company_name: Optional[str] = None  # populated via SQL JOIN in ContactRepository
    enriched_at: Optional[datetime] = None
    enrichment_data: Optional[Any] = None
    persona_type: Optional[str] = None
    assigned_to_id: Optional[UUID] = None    # AE
    assigned_to_name: Optional[str] = None   # populated via JOIN
    assigned_rep_email: Optional[str] = None
    sdr_id: Optional[UUID] = None            # SDR
    sdr_name: Optional[str] = None           # populated via JOIN
    outreach_lane: Optional[str] = None
    sequence_status: Optional[str] = None
    instantly_status: Optional[str] = None
    instantly_campaign_id: Optional[str] = None
    warm_intro_strength: Optional[int] = None
    warm_intro_path: Optional[Any] = None
    conversation_starter: Optional[str] = None
    personalization_notes: Optional[str] = None
    talking_points: Optional[Any] = None
    tracking_stage: Optional[str] = None
    tracking_summary: Optional[str] = None
    tracking_score: Optional[int] = None
    tracking_label: Optional[str] = None
    tracking_last_activity_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class ContactUpdate(SQLModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    email_verified: Optional[bool] = None
    phone: Optional[str] = None
    title: Optional[str] = None
    seniority: Optional[str] = None
    linkedin_url: Optional[str] = None
    persona: Optional[str] = None
    company_id: Optional[UUID] = None
    enriched_at: Optional[datetime] = None
    enrichment_data: Optional[Any] = None
    persona_type: Optional[str] = None
    assigned_to_id: Optional[UUID] = None
    assigned_rep_email: Optional[str] = None
    sdr_id: Optional[UUID] = None
    sdr_name: Optional[str] = None
    outreach_lane: Optional[str] = None
    sequence_status: Optional[str] = None
    instantly_status: Optional[str] = None
    instantly_campaign_id: Optional[str] = None
    warm_intro_strength: Optional[int] = None
    warm_intro_path: Optional[Any] = None
    conversation_starter: Optional[str] = None
    personalization_notes: Optional[str] = None
    talking_points: Optional[Any] = None
