from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID, uuid4

from sqlalchemy import Column, Numeric
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class DealBase(SQLModel):
    name: str
    stage: str = "discovery"
    close_date_est: Optional[date] = None
    health: str = "green"
    health_score: Optional[int] = None
    days_in_stage: int = 0
    stage_entered_at: Optional[datetime] = None
    last_activity_at: Optional[datetime] = None
    stakeholder_count: int = 0
    owner_id: Optional[str] = None


class Deal(DealBase, table=True):
    __tablename__ = "deals"

    id: Optional[UUID] = Field(default_factory=uuid4, primary_key=True)
    company_id: Optional[UUID] = Field(default=None, foreign_key="companies.id", index=True)
    value: Optional[Decimal] = Field(default=None, sa_column=Column(Numeric(15, 2)))
    qualification: Optional[Any] = Field(default=None, sa_column=Column(JSONB))
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class DealCreate(DealBase):
    company_id: Optional[UUID] = None
    value: Optional[Decimal] = None
    qualification: Optional[Any] = None


class DealRead(DealBase):
    id: UUID
    company_id: Optional[UUID] = None
    value: Optional[Decimal] = None
    qualification: Optional[Any] = None
    created_at: datetime
    updated_at: datetime


class DealUpdate(SQLModel):
    name: Optional[str] = None
    stage: Optional[str] = None
    company_id: Optional[UUID] = None
    value: Optional[Decimal] = None
    close_date_est: Optional[date] = None
    health: Optional[str] = None
    health_score: Optional[int] = None
    qualification: Optional[Any] = None
    days_in_stage: Optional[int] = None
    stage_entered_at: Optional[datetime] = None
    last_activity_at: Optional[datetime] = None
    stakeholder_count: Optional[int] = None
    owner_id: Optional[str] = None
