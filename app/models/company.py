from datetime import datetime
from typing import Any, Optional
from uuid import UUID, uuid4

from sqlalchemy import Column, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class CompanyBase(SQLModel):
    name: str
    domain: str
    industry: Optional[str] = None
    vertical: Optional[str] = None
    employee_count: Optional[int] = None
    arr_estimate: Optional[float] = None
    funding_stage: Optional[str] = None
    has_dap: bool = False
    dap_tool: Optional[str] = None


class Company(CompanyBase, table=True):
    __tablename__ = "companies"

    id: Optional[UUID] = Field(default_factory=uuid4, primary_key=True)
    tech_stack: Optional[Any] = Field(default=None, sa_column=Column(JSONB))
    icp_score: Optional[int] = None
    icp_tier: Optional[str] = None
    enrichment_sources: Optional[Any] = Field(default=None, sa_column=Column(JSONB))
    enriched_at: Optional[datetime] = None
    # Account sourcing fields
    description: Optional[str] = Field(default=None, sa_column=Column(Text))
    intent_signals: Optional[Any] = Field(default=None, sa_column=Column(JSONB))
    sourcing_batch_id: Optional[UUID] = Field(default=None, foreign_key="sourcing_batches.id", index=True)
    enrichment_cache: Optional[Any] = Field(default=None, sa_column=Column(JSONB))
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CompanyCreate(CompanyBase):
    tech_stack: Optional[Any] = None


class CompanyRead(CompanyBase):
    id: UUID
    tech_stack: Optional[Any] = None
    icp_score: Optional[int] = None
    icp_tier: Optional[str] = None
    enrichment_sources: Optional[Any] = None
    enriched_at: Optional[datetime] = None
    description: Optional[str] = None
    intent_signals: Optional[Any] = None
    sourcing_batch_id: Optional[UUID] = None
    enrichment_cache: Optional[Any] = None
    created_at: datetime
    updated_at: datetime


class CompanyUpdate(SQLModel):
    name: Optional[str] = None
    domain: Optional[str] = None
    industry: Optional[str] = None
    vertical: Optional[str] = None
    employee_count: Optional[int] = None
    arr_estimate: Optional[float] = None
    funding_stage: Optional[str] = None
    tech_stack: Optional[Any] = None
    has_dap: Optional[bool] = None
    dap_tool: Optional[str] = None
    icp_score: Optional[int] = None
    icp_tier: Optional[str] = None
    enrichment_sources: Optional[Any] = None
    enriched_at: Optional[datetime] = None
