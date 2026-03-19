"""
Signal model — buying/intent signals per company.

Signal types:
  funding    — raised Series A, closed round, etc.
  jobs       — new CTO hired, job posting for relevant role
  review     — G2/Capterra review published
  pr         — press release, blog post, product launch
  linkedin   — LinkedIn post, company update
  news       — general news mention
"""
from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class SignalBase(SQLModel):
    company_id: UUID
    signal_type: str          # funding | jobs | review | pr | linkedin | news
    source: str               # google_news | linkedin | g2 | hunter | manual
    title: str
    url: Optional[str] = None
    summary: Optional[str] = None
    published_at: Optional[datetime] = None
    relevance_score: Optional[int] = None  # 1-100, AI-assigned


class Signal(SignalBase, table=True):
    __tablename__ = "signals"

    id: Optional[UUID] = Field(default_factory=uuid4, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SignalCreate(SignalBase):
    pass


class SignalRead(SignalBase):
    id: UUID
    created_at: datetime
