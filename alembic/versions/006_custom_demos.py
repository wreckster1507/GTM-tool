"""Add custom_demos table

Revision ID: 006
Revises: 005
Create Date: 2026-03-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "custom_demos",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=True),
        sa.Column("deal_id", sa.UUID(), nullable=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("client_name", sa.String(), nullable=True),
        sa.Column("client_domain", sa.String(), nullable=True),
        sa.Column("creation_path", sa.String(), nullable=False, server_default="file_upload"),
        sa.Column("source_filename", sa.String(), nullable=True),
        sa.Column("source_text", sa.Text(), nullable=True),
        sa.Column("editor_content", JSONB(), nullable=True),
        sa.Column("brand_data", JSONB(), nullable=True),
        sa.Column("html_content", sa.Text(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="draft"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["deal_id"], ["deals.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_custom_demos_company_id", "custom_demos", ["company_id"])
    op.create_index("ix_custom_demos_deal_id", "custom_demos", ["deal_id"])


def downgrade() -> None:
    op.drop_index("ix_custom_demos_deal_id", "custom_demos")
    op.drop_index("ix_custom_demos_company_id", "custom_demos")
    op.drop_table("custom_demos")
