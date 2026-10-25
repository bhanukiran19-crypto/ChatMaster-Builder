"""Create initial ChatMaster workspace and flow tables."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

json_document = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "chatmaster_workspaces",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "chatmaster_workspace_members",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("clerk_user_id", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["chatmaster_workspaces.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id", "clerk_user_id", name="uq_chatmaster_member_workspace_user"
        ),
    )
    op.create_index(
        "ix_chatmaster_workspace_members_clerk_user_id",
        "chatmaster_workspace_members",
        ["clerk_user_id"],
        unique=False,
    )
    op.create_table(
        "chatmaster_flows",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=1000), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("graph", json_document, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["chatmaster_workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chatmaster_flows_workspace_id", "chatmaster_flows", ["workspace_id"], unique=False)
    op.create_table(
        "chatmaster_audit_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("actor_clerk_user_id", sa.String(length=255), nullable=False),
        sa.Column("action", sa.String(length=80), nullable=False),
        sa.Column("entity_type", sa.String(length=80), nullable=False),
        sa.Column("entity_id", sa.String(length=80), nullable=False),
        sa.Column("details", json_document, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["chatmaster_workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chatmaster_audit_events_workspace_id", "chatmaster_audit_events", ["workspace_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_chatmaster_audit_events_workspace_id", table_name="chatmaster_audit_events")
    op.drop_table("chatmaster_audit_events")
    op.drop_index("ix_chatmaster_flows_workspace_id", table_name="chatmaster_flows")
    op.drop_table("chatmaster_flows")
    op.drop_index(
        "ix_chatmaster_workspace_members_clerk_user_id",
        table_name="chatmaster_workspace_members",
    )
    op.drop_table("chatmaster_workspace_members")
    op.drop_table("chatmaster_workspaces")
