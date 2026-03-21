"""Drop deep_enriched_at columns (deep enrich removed)

Revision ID: 008
Revises: 007
"""
from alembic import op
import sqlalchemy as sa

revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("companies", "deep_enriched_at")
    op.drop_column("contacts", "deep_enriched_at")


def downgrade() -> None:
    op.add_column("contacts", sa.Column("deep_enriched_at", sa.DateTime(), nullable=True))
    op.add_column("companies", sa.Column("deep_enriched_at", sa.DateTime(), nullable=True))
