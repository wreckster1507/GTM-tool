"""
CustomDemo — stores AI-generated interactive HTML demos.

Two creation paths:
  - file_upload: user uploads a PDF/DOCX production guide
  - editor:      user builds the production guide in the CRM editor
"""
from datetime import datetime
from typing import Any, Optional
from uuid import UUID, uuid4

from sqlalchemy import Column, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class CustomDemo(SQLModel, table=True):
    __tablename__ = "custom_demos"

    id: Optional[UUID] = Field(default_factory=uuid4, primary_key=True)

    # Linked entity (optional — demos can exist without a deal)
    company_id: Optional[UUID] = Field(default=None, foreign_key="companies.id", index=True)
    deal_id: Optional[UUID] = Field(default=None, foreign_key="deals.id", index=True)

    title: str
    client_name: Optional[str] = None
    client_domain: Optional[str] = None
    creation_path: str = "file_upload"   # file_upload | editor | brief

    # Source material (Path A)
    source_filename: Optional[str] = None
    source_text: Optional[str] = Field(default=None, sa_column=Column(Text))

    # Editor content (Path B) — list of scenes with prompts/steps
    editor_content: Optional[Any] = Field(default=None, sa_column=Column(JSONB))

    # Brand data scraped from client website
    brand_data: Optional[Any] = Field(default=None, sa_column=Column(JSONB))

    # Generated HTML output
    html_content: Optional[str] = Field(default=None, sa_column=Column(Text))

    # State
    status: str = "draft"          # draft | generating | ready | error
    error_message: Optional[str] = Field(default=None, sa_column=Column(Text))

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
