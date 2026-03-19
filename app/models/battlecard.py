"""
Battlecard model — live-meeting knowledge base.

Categories:
  objection        — common objections + rebuttals
  competitor       — competitor comparison
  tech_faq         — technical questions + answers
  pricing          — pricing objections
  use_case         — relevant use cases / customer stories
"""
from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import Column, Text
from sqlmodel import Field, SQLModel


class BattlecardBase(SQLModel):
    category: str       # objection | competitor | tech_faq | pricing | use_case
    title: str
    trigger: str        # short phrase that surfaces this card (e.g. "security", "price too high")
    response: str       # the actual answer / rebuttal
    competitor: Optional[str] = None   # filled when category == competitor
    tags: Optional[str] = None         # comma-separated


class Battlecard(BattlecardBase, table=True):
    __tablename__ = "battlecards"

    id: Optional[UUID] = Field(default_factory=uuid4, primary_key=True)
    response: str = Field(sa_column=Column(Text))
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class BattlecardCreate(BattlecardBase):
    pass


class BattlecardRead(BattlecardBase):
    id: UUID
    is_active: bool
    created_at: datetime
    updated_at: datetime


class BattlecardUpdate(SQLModel):
    category: Optional[str] = None
    title: Optional[str] = None
    trigger: Optional[str] = None
    response: Optional[str] = None
    competitor: Optional[str] = None
    tags: Optional[str] = None
    is_active: Optional[bool] = None
