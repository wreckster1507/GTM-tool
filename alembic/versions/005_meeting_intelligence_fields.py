"""Add demo_strategy and research_data fields to meetings table

Revision ID: 005
Revises: 004
Create Date: 2026-03-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("meetings", sa.Column("demo_strategy", sa.Text(), nullable=True))
    op.add_column("meetings", sa.Column("research_data", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("meetings", "research_data")
    op.drop_column("meetings", "demo_strategy")
