"""Add company sourcing workflow fields

Revision ID: 010
Revises: 009
"""
from alembic import op
import sqlalchemy as sa

revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("companies", sa.Column("assigned_rep", sa.String(), nullable=True))
    op.add_column("companies", sa.Column("outreach_status", sa.String(), nullable=True))
    op.add_column("companies", sa.Column("disposition", sa.String(), nullable=True))
    op.add_column("companies", sa.Column("rep_feedback", sa.Text(), nullable=True))
    op.add_column("companies", sa.Column("last_outreach_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("companies", "last_outreach_at")
    op.drop_column("companies", "rep_feedback")
    op.drop_column("companies", "disposition")
    op.drop_column("companies", "outreach_status")
    op.drop_column("companies", "assigned_rep")
