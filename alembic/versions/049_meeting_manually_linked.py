"""Add manually_linked flag to meetings (prevents calendar sync from overwriting user re-links)

Revision ID: 049
Revises: 048
Create Date: 2026-04-19
"""

from alembic import op
import sqlalchemy as sa

revision = "049"
down_revision = "048"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "meetings",
        sa.Column(
            "manually_linked",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.alter_column("meetings", "manually_linked", server_default=None)


def downgrade():
    op.drop_column("meetings", "manually_linked")
