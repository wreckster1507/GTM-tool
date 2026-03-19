"""Add outreach_sequences table

Revision ID: 002
Revises: 001
Create Date: 2026-03-16

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "outreach_sequences",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("contact_id", UUID(as_uuid=True), sa.ForeignKey("contacts.id"), nullable=False, index=True),
        sa.Column("company_id", UUID(as_uuid=True), sa.ForeignKey("companies.id"), nullable=False, index=True),
        sa.Column("persona", sa.String, nullable=True),
        sa.Column("status", sa.String, nullable=False, server_default="draft"),

        # Email bodies
        sa.Column("email_1", sa.Text, nullable=True),
        sa.Column("email_2", sa.Text, nullable=True),
        sa.Column("email_3", sa.Text, nullable=True),
        sa.Column("linkedin_message", sa.Text, nullable=True),

        # Subject lines
        sa.Column("subject_1", sa.String, nullable=True),
        sa.Column("subject_2", sa.String, nullable=True),
        sa.Column("subject_3", sa.String, nullable=True),

        # Generation metadata
        sa.Column("generation_context", JSONB, nullable=True),
        sa.Column("generated_at", sa.DateTime, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("outreach_sequences")
