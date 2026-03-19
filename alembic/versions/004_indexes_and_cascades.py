"""Add DB indexes and fix FK cascade rules on outreach_sequences.

Fixes:
  - outreach_sequences.contact_id: NO ACTION → ON DELETE CASCADE
    (deleting a contact previously caused FK violation at app layer)
  - outreach_sequences.company_id: NO ACTION → ON DELETE CASCADE
    (same issue when deleting a company)

Indexes added for every FK column that lacks one (prevents full-table scans
on JOIN/WHERE queries as the dataset scales) plus high-cardinality filter
columns used in list endpoints.

Revision ID: 004
Revises: 003
"""
from alembic import op

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Fix outreach_sequences FK cascade rules ──────────────────────────────
    op.drop_constraint(
        "outreach_sequences_contact_id_fkey",
        "outreach_sequences",
        type_="foreignkey",
    )
    op.drop_constraint(
        "outreach_sequences_company_id_fkey",
        "outreach_sequences",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "outreach_sequences_contact_id_fkey",
        "outreach_sequences",
        "contacts",
        ["contact_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "outreach_sequences_company_id_fkey",
        "outreach_sequences",
        "companies",
        ["company_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # ── Indexes on FK columns (prevent seq-scan on every JOIN) ───────────────
    # contacts.company_id already indexed via SQLModel index=True, skip.
    # deals.company_id already indexed via SQLModel index=True, skip.
    # activities.deal_id and activities.contact_id already indexed.
    # outreach_sequences FK columns already indexed via SQLModel index=True.

    # ── Indexes on commonly filtered / sorted columns ────────────────────────
    op.create_index(
        "ix_companies_icp_tier",
        "companies",
        ["icp_tier"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_companies_icp_score",
        "companies",
        ["icp_score"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_deals_stage",
        "deals",
        ["stage"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_deals_health",
        "deals",
        ["health"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_contacts_email",
        "contacts",
        ["email"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_contacts_persona",
        "contacts",
        ["persona"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_signals_company_id",
        "signals",
        ["company_id"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_signals_signal_type",
        "signals",
        ["signal_type"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_meetings_company_id",
        "meetings",
        ["company_id"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_meetings_status",
        "meetings",
        ["status"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_battlecards_category",
        "battlecards",
        ["category"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_battlecards_is_active",
        "battlecards",
        ["is_active"],
        if_not_exists=True,
    )


def downgrade() -> None:
    # Revert cascade rules
    op.drop_constraint(
        "outreach_sequences_contact_id_fkey",
        "outreach_sequences",
        type_="foreignkey",
    )
    op.drop_constraint(
        "outreach_sequences_company_id_fkey",
        "outreach_sequences",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "outreach_sequences_contact_id_fkey",
        "outreach_sequences",
        "contacts",
        ["contact_id"],
        ["id"],
    )
    op.create_foreign_key(
        "outreach_sequences_company_id_fkey",
        "outreach_sequences",
        "companies",
        ["company_id"],
        ["id"],
    )

    # Drop added indexes
    for name, table in [
        ("ix_companies_icp_tier", "companies"),
        ("ix_companies_icp_score", "companies"),
        ("ix_deals_stage", "deals"),
        ("ix_deals_health", "deals"),
        ("ix_contacts_email", "contacts"),
        ("ix_contacts_persona", "contacts"),
        ("ix_signals_company_id", "signals"),
        ("ix_signals_signal_type", "signals"),
        ("ix_meetings_company_id", "meetings"),
        ("ix_meetings_status", "meetings"),
        ("ix_battlecards_category", "battlecards"),
        ("ix_battlecards_is_active", "battlecards"),
    ]:
        op.drop_index(name, table_name=table, if_exists=True)
