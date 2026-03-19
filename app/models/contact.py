from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class ContactBase(SQLModel):
    first_name: str
    last_name: str
    email: Optional[str] = None
    email_verified: bool = False
    phone: Optional[str] = None
    title: Optional[str] = None
    seniority: Optional[str] = None
    linkedin_url: Optional[str] = None
    persona: Optional[str] = None


class Contact(ContactBase, table=True):
    __tablename__ = "contacts"

    id: Optional[UUID] = Field(default_factory=uuid4, primary_key=True)
    company_id: Optional[UUID] = Field(default=None, foreign_key="companies.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ContactCreate(ContactBase):
    company_id: Optional[UUID] = None


class ContactRead(ContactBase):
    id: UUID
    company_id: Optional[UUID] = None
    company_name: Optional[str] = None  # populated via SQL JOIN in ContactRepository
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
