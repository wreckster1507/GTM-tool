"""Sales Knowledge Base — sales_resources table

Revision ID: 009
Revises: 008
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sales_resources",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("category", sa.String(50), nullable=False),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("filename", sa.String(255), nullable=True),
        sa.Column("file_size", sa.Integer(), nullable=True),
        sa.Column("tags", JSONB, server_default="[]"),
        sa.Column("modules", JSONB, server_default="[]"),
        sa.Column("is_active", sa.Boolean(), server_default="true"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_sales_resources_category", "sales_resources", ["category"])
    op.create_index("ix_sales_resources_is_active", "sales_resources", ["is_active"])


def downgrade() -> None:
    op.drop_index("ix_sales_resources_is_active")
    op.drop_index("ix_sales_resources_category")
    op.drop_table("sales_resources")
