"""add prospecting and outreach workflow fields

Revision ID: 011
Revises: 010
Create Date: 2026-03-21
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("companies", sa.Column("assigned_rep_email", sa.String(), nullable=True))
    op.add_column("companies", sa.Column("assigned_rep_name", sa.String(), nullable=True))
    op.add_column("companies", sa.Column("account_thesis", sa.Text(), nullable=True))
    op.add_column("companies", sa.Column("why_now", sa.Text(), nullable=True))
    op.add_column("companies", sa.Column("beacon_angle", sa.Text(), nullable=True))
    op.add_column("companies", sa.Column("recommended_outreach_lane", sa.String(), nullable=True))
    op.add_column("companies", sa.Column("instantly_campaign_id", sa.String(), nullable=True))
    op.add_column("companies", sa.Column("prospecting_profile", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("companies", sa.Column("outreach_plan", postgresql.JSONB(astext_type=sa.Text()), nullable=True))

    op.add_column("contacts", sa.Column("assigned_rep_email", sa.String(), nullable=True))
    op.add_column("contacts", sa.Column("outreach_lane", sa.String(), nullable=True))
    op.add_column("contacts", sa.Column("sequence_status", sa.String(), nullable=True))
    op.add_column("contacts", sa.Column("instantly_status", sa.String(), nullable=True))
    op.add_column("contacts", sa.Column("instantly_campaign_id", sa.String(), nullable=True))
    op.add_column("contacts", sa.Column("warm_intro_strength", sa.Integer(), nullable=True))
    op.add_column("contacts", sa.Column("warm_intro_path", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("contacts", sa.Column("conversation_starter", sa.Text(), nullable=True))
    op.add_column("contacts", sa.Column("personalization_notes", sa.Text(), nullable=True))
    op.add_column("contacts", sa.Column("talking_points", postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column("contacts", "talking_points")
    op.drop_column("contacts", "personalization_notes")
    op.drop_column("contacts", "conversation_starter")
    op.drop_column("contacts", "warm_intro_path")
    op.drop_column("contacts", "warm_intro_strength")
    op.drop_column("contacts", "instantly_campaign_id")
    op.drop_column("contacts", "instantly_status")
    op.drop_column("contacts", "sequence_status")
    op.drop_column("contacts", "outreach_lane")
    op.drop_column("contacts", "assigned_rep_email")

    op.drop_column("companies", "outreach_plan")
    op.drop_column("companies", "prospecting_profile")
    op.drop_column("companies", "instantly_campaign_id")
    op.drop_column("companies", "recommended_outreach_lane")
    op.drop_column("companies", "beacon_angle")
    op.drop_column("companies", "why_now")
    op.drop_column("companies", "account_thesis")
    op.drop_column("companies", "assigned_rep_name")
    op.drop_column("companies", "assigned_rep_email")
