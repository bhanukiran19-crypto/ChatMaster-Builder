"""Add immutable publish snapshots and persisted flow simulations."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0002_flow_runtime"
down_revision = "0001_initial"
branch_labels = None
depends_on = None

json_document = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.add_column("chatmaster_flows", sa.Column("published_graph", json_document, nullable=True))
    op.add_column(
        "chatmaster_flows",
        sa.Column("draft_version", sa.Integer(), nullable=False, server_default=sa.text("1")),
    )
    op.add_column(
        "chatmaster_flows",
        sa.Column("published_version", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.create_table(
        "chatmaster_flow_executions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("flow_id", sa.Uuid(), nullable=False),
        sa.Column("mode", sa.String(length=20), nullable=False, server_default="simulation"),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("flow_version", sa.Integer(), nullable=False),
        sa.Column("graph_snapshot", json_document, nullable=False),
        sa.Column("current_node_id", sa.String(length=80), nullable=True),
        sa.Column("context", json_document, nullable=False),
        sa.Column("messages", json_document, nullable=False),
        sa.Column("trace", json_document, nullable=False),
        sa.Column("error", sa.String(length=1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["chatmaster_workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["flow_id"], ["chatmaster_flows.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_chatmaster_flow_executions_workspace_id",
        "chatmaster_flow_executions",
        ["workspace_id"],
        unique=False,
    )
    op.create_index(
        "ix_chatmaster_flow_executions_flow_id",
        "chatmaster_flow_executions",
        ["flow_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_chatmaster_flow_executions_flow_id", table_name="chatmaster_flow_executions")
    op.drop_index(
        "ix_chatmaster_flow_executions_workspace_id",
        table_name="chatmaster_flow_executions",
    )
    op.drop_table("chatmaster_flow_executions")
    op.drop_column("chatmaster_flows", "published_version")
    op.drop_column("chatmaster_flows", "draft_version")
    op.drop_column("chatmaster_flows", "published_graph")
