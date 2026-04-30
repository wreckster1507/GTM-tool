"""add zippy_system_prompt column to workspace_settings

Revision ID: 058
Revises: 057
Create Date: 2026-04-29
"""

from alembic import op
import sqlalchemy as sa


revision = "058"
down_revision = "057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspace_settings",
        sa.Column("zippy_system_prompt", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("workspace_settings", "zippy_system_prompt")
