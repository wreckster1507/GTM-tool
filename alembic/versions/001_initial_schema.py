"""Initial schema — companies, contacts, deals, activities

Revision ID: 001
Revises:
Create Date: 2026-03-16

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- companies ---
    op.create_table(
        "companies",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("domain", sa.String(), nullable=False),
        sa.Column("industry", sa.String(), nullable=True),
        sa.Column("vertical", sa.String(), nullable=True),
        sa.Column("employee_count", sa.Integer(), nullable=True),
        sa.Column("arr_estimate", sa.Float(), nullable=True),
        sa.Column("funding_stage", sa.String(), nullable=True),
        sa.Column("tech_stack", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("has_dap", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("dap_tool", sa.String(), nullable=True),
        sa.Column("icp_score", sa.Integer(), nullable=True),
        sa.Column("icp_tier", sa.String(), nullable=True),
        sa.Column("enrichment_sources", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("enriched_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_companies_domain", "companies", ["domain"], unique=True)
    op.create_index("ix_companies_name", "companies", ["name"], unique=False)

    # --- contacts ---
    op.create_table(
        "contacts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("first_name", sa.String(), nullable=False),
        sa.Column("last_name", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("phone", sa.String(), nullable=True),
        sa.Column("title", sa.String(), nullable=True),
        sa.Column("seniority", sa.String(), nullable=True),
        sa.Column("linkedin_url", sa.String(), nullable=True),
        sa.Column("persona", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_contacts_email", "contacts", ["email"], unique=False)
    op.create_index("ix_contacts_company_id", "contacts", ["company_id"], unique=False)

    # --- deals ---
    op.create_table(
        "deals",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("stage", sa.String(), nullable=False, server_default="discovery"),
        sa.Column("value", sa.Numeric(precision=15, scale=2), nullable=True),
        sa.Column("close_date_est", sa.Date(), nullable=True),
        sa.Column("health", sa.String(), nullable=False, server_default="green"),
        sa.Column("health_score", sa.Integer(), nullable=True),
        sa.Column("qualification", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("days_in_stage", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("stage_entered_at", sa.DateTime(), nullable=True),
        sa.Column("last_activity_at", sa.DateTime(), nullable=True),
        sa.Column("stakeholder_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("owner_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_deals_company_id", "deals", ["company_id"], unique=False)
    op.create_index("ix_deals_stage", "deals", ["stage"], unique=False)

    # --- activities ---
    op.create_table(
        "activities",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("deal_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("contact_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=True),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("ai_summary", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["deal_id"], ["deals.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["contact_id"], ["contacts.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_activities_deal_id", "activities", ["deal_id"], unique=False)
    op.create_index("ix_activities_contact_id", "activities", ["contact_id"], unique=False)
    op.create_index("ix_activities_created_at", "activities", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_table("activities")
    op.drop_table("deals")
    op.drop_table("contacts")
    op.drop_table("companies")
