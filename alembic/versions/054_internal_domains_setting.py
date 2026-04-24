"""Add internal_domains JSONB to workspace_settings.

Revision ID: 054
Revises: 053
Create Date: 2026-04-24
"""

from alembic import op
import sqlalchemy as sa


revision = "054"
down_revision = "053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspace_settings",
        sa.Column(
            "internal_domains",
            sa.JSON(),
            nullable=False,
            server_default='["beacon.li"]',
        ),
    )


def downgrade() -> None:
    op.drop_column("workspace_settings", "internal_domains")
