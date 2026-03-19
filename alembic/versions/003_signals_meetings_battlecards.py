"""Add signals, meetings, battlecards tables

Revision ID: 003
Revises: 002
Create Date: 2026-03-17

New tables:
  - signals      : buying/intent signals per company (funding, PR, jobs, news)
  - meetings     : meeting lifecycle tracking with pre-brief + post-score
  - battlecards  : live-meeting knowledge base (objections, FAQs, competitors)
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── signals ───────────────────────────────────────────────────────────────
    op.create_table(
        "signals",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("signal_type", sa.String, nullable=False),   # funding|jobs|review|pr|linkedin|news
        sa.Column("source", sa.String, nullable=False),        # google_news|linkedin|g2|manual
        sa.Column("title", sa.String, nullable=False),
        sa.Column("url", sa.String, nullable=True),
        sa.Column("summary", sa.Text, nullable=True),
        sa.Column("published_at", sa.DateTime, nullable=True),
        sa.Column("relevance_score", sa.Integer, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )

    # ── meetings ──────────────────────────────────────────────────────────────
    op.create_table(
        "meetings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String, nullable=False),
        sa.Column("company_id", UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("deal_id", UUID(as_uuid=True), sa.ForeignKey("deals.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("scheduled_at", sa.DateTime, nullable=True),
        sa.Column("status", sa.String, nullable=False, server_default="scheduled"),
        sa.Column("meeting_type", sa.String, nullable=False, server_default="discovery"),
        # Pre-meeting
        sa.Column("pre_brief", sa.Text, nullable=True),
        sa.Column("attendees", JSONB, nullable=True),
        # Post-meeting
        sa.Column("raw_notes", sa.Text, nullable=True),
        sa.Column("ai_summary", sa.Text, nullable=True),
        sa.Column("mom_draft", sa.Text, nullable=True),
        sa.Column("meeting_score", sa.Integer, nullable=True),
        sa.Column("what_went_right", sa.Text, nullable=True),
        sa.Column("what_went_wrong", sa.Text, nullable=True),
        sa.Column("next_steps", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )

    # ── battlecards ───────────────────────────────────────────────────────────
    op.create_table(
        "battlecards",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("category", sa.String, nullable=False),    # objection|competitor|tech_faq|pricing|use_case
        sa.Column("title", sa.String, nullable=False),
        sa.Column("trigger", sa.String, nullable=False),
        sa.Column("response", sa.Text, nullable=False),
        sa.Column("competitor", sa.String, nullable=True),
        sa.Column("tags", sa.String, nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("battlecards")
    op.drop_table("meetings")
    op.drop_table("signals")
