"""Add sourcing_batches table and extend companies/contacts for account sourcing

Revision ID: 007
Revises: 006
Create Date: 2026-03-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── New table: sourcing_batches ─────────────────────────────────────────
    op.create_table(
        "sourcing_batches",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("total_rows", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("processed_rows", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_companies", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("skipped_rows", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed_rows", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_log", JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    # ── Extend companies table ──────────────────────────────────────────────
    op.add_column("companies", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("companies", sa.Column("intent_signals", JSONB(), nullable=True))
    op.add_column("companies", sa.Column("sourcing_batch_id", sa.UUID(), nullable=True))
    op.add_column("companies", sa.Column("deep_enriched_at", sa.DateTime(), nullable=True))
    op.add_column("companies", sa.Column("enrichment_cache", JSONB(), nullable=True))

    op.create_foreign_key(
        "fk_companies_sourcing_batch_id",
        "companies",
        "sourcing_batches",
        ["sourcing_batch_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_companies_sourcing_batch_id", "companies", ["sourcing_batch_id"])

    # ── Extend contacts table ───────────────────────────────────────────────
    op.add_column("contacts", sa.Column("enriched_at", sa.DateTime(), nullable=True))
    op.add_column("contacts", sa.Column("deep_enriched_at", sa.DateTime(), nullable=True))
    op.add_column("contacts", sa.Column("enrichment_data", JSONB(), nullable=True))
    op.add_column("contacts", sa.Column("persona_type", sa.String(), nullable=True))


def downgrade() -> None:
    # ── Revert contacts ────────────────────────────────────────────────────
    op.drop_column("contacts", "persona_type")
    op.drop_column("contacts", "enrichment_data")
    op.drop_column("contacts", "deep_enriched_at")
    op.drop_column("contacts", "enriched_at")

    # ── Revert companies ───────────────────────────────────────────────────
    op.drop_index("ix_companies_sourcing_batch_id", "companies")
    op.drop_constraint("fk_companies_sourcing_batch_id", "companies", type_="foreignkey")
    op.drop_column("companies", "enrichment_cache")
    op.drop_column("companies", "deep_enriched_at")
    op.drop_column("companies", "sourcing_batch_id")
    op.drop_column("companies", "intent_signals")
    op.drop_column("companies", "description")

    # ── Drop sourcing_batches ──────────────────────────────────────────────
    op.drop_table("sourcing_batches")
