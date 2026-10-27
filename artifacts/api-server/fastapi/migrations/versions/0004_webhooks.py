"""Add signed webhook endpoints, event outbox, and delivery history."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004_webhooks"
down_revision = "0003_simulation_step_budget"
branch_labels = None
depends_on = None

json_document = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "chatmaster_webhook_endpoints",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("direction", sa.String(length=20), nullable=False),
        sa.Column("url", sa.String(length=2048), nullable=True),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "(direction = 'incoming' AND url IS NULL) OR "
            "(direction = 'outgoing' AND url IS NOT NULL)",
            name="ck_chatmaster_webhook_endpoint_direction_url",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["chatmaster_workspaces.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_chatmaster_webhook_endpoints_workspace_id",
        "chatmaster_webhook_endpoints",
        ["workspace_id"],
        unique=False,
    )

    op.create_table(
        "chatmaster_webhook_subscriptions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("endpoint_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["endpoint_id"], ["chatmaster_webhook_endpoints.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "endpoint_id",
            "event_type",
            name="uq_chatmaster_webhook_subscription",
        ),
    )
    op.create_index(
        "ix_chatmaster_webhook_subscriptions_endpoint_id",
        "chatmaster_webhook_subscriptions",
        ["endpoint_id"],
        unique=False,
    )

    op.create_table(
        "chatmaster_webhook_signing_secrets",
        sa.Column("endpoint_id", sa.Uuid(), nullable=False),
        sa.Column("secret_reference", sa.Uuid(), nullable=False),
        sa.Column("encrypted_secret", sa.LargeBinary(), nullable=False),
        sa.Column("nonce", sa.LargeBinary(), nullable=False),
        sa.Column("key_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["endpoint_id"], ["chatmaster_webhook_endpoints.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("endpoint_id"),
        sa.UniqueConstraint(
            "secret_reference",
            name="uq_chatmaster_webhook_signing_secrets_secret_reference",
        ),
    )

    op.create_table(
        "chatmaster_webhook_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("source_endpoint_id", sa.Uuid(), nullable=True),
        sa.Column("source_event_id", sa.String(length=200), nullable=True),
        sa.Column("event_type", sa.String(length=120), nullable=False),
        sa.Column("payload", json_document, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["source_endpoint_id"],
            ["chatmaster_webhook_endpoints.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["chatmaster_workspaces.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "source_endpoint_id",
            "source_event_id",
            name="uq_chatmaster_webhook_source_event",
        ),
    )
    op.create_index(
        "ix_chatmaster_webhook_events_workspace_id",
        "chatmaster_webhook_events",
        ["workspace_id"],
        unique=False,
    )

    op.create_table(
        "chatmaster_webhook_deliveries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("endpoint_id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("last_error", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'delivering', 'delivered', 'failed', 'cancelled')",
            name="ck_chatmaster_webhook_delivery_status",
        ),
        sa.ForeignKeyConstraint(
            ["endpoint_id"], ["chatmaster_webhook_endpoints.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["event_id"], ["chatmaster_webhook_events.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["chatmaster_workspaces.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "endpoint_id",
            "event_id",
            name="uq_chatmaster_webhook_delivery",
        ),
    )
    op.create_index(
        "ix_chatmaster_webhook_delivery_due",
        "chatmaster_webhook_deliveries",
        ["status", "next_attempt_at"],
        unique=False,
    )
    op.create_index(
        "ix_chatmaster_webhook_deliveries_workspace_id",
        "chatmaster_webhook_deliveries",
        ["workspace_id"],
        unique=False,
    )
    op.create_index(
        "ix_chatmaster_webhook_deliveries_endpoint_id",
        "chatmaster_webhook_deliveries",
        ["endpoint_id"],
        unique=False,
    )
    op.create_index(
        "ix_chatmaster_webhook_deliveries_event_id",
        "chatmaster_webhook_deliveries",
        ["event_id"],
        unique=False,
    )

    op.create_table(
        "chatmaster_webhook_delivery_attempts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("delivery_id", sa.Uuid(), nullable=False),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("request_started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("response_status", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.String(length=500), nullable=True),
        sa.CheckConstraint(
            "status IN ('in_progress', 'succeeded', 'failed')",
            name="ck_chatmaster_webhook_attempt_status",
        ),
        sa.ForeignKeyConstraint(
            ["delivery_id"],
            ["chatmaster_webhook_deliveries.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "delivery_id",
            "attempt_number",
            name="uq_chatmaster_webhook_attempt_number",
        ),
    )
    op.create_index(
        "ix_chatmaster_webhook_delivery_attempts_delivery_id",
        "chatmaster_webhook_delivery_attempts",
        ["delivery_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_chatmaster_webhook_delivery_attempts_delivery_id",
        table_name="chatmaster_webhook_delivery_attempts",
    )
    op.drop_table("chatmaster_webhook_delivery_attempts")
    op.drop_index(
        "ix_chatmaster_webhook_deliveries_event_id",
        table_name="chatmaster_webhook_deliveries",
    )
    op.drop_index(
        "ix_chatmaster_webhook_deliveries_endpoint_id",
        table_name="chatmaster_webhook_deliveries",
    )
    op.drop_index(
        "ix_chatmaster_webhook_deliveries_workspace_id",
        table_name="chatmaster_webhook_deliveries",
    )
    op.drop_index(
        "ix_chatmaster_webhook_delivery_due",
        table_name="chatmaster_webhook_deliveries",
    )
    op.drop_table("chatmaster_webhook_deliveries")
    op.drop_index(
        "ix_chatmaster_webhook_events_workspace_id",
        table_name="chatmaster_webhook_events",
    )
    op.drop_table("chatmaster_webhook_events")
    op.drop_table("chatmaster_webhook_signing_secrets")
    op.drop_index(
        "ix_chatmaster_webhook_subscriptions_endpoint_id",
        table_name="chatmaster_webhook_subscriptions",
    )
    op.drop_table("chatmaster_webhook_subscriptions")
    op.drop_index(
        "ix_chatmaster_webhook_endpoints_workspace_id",
        table_name="chatmaster_webhook_endpoints",
    )
    op.drop_table("chatmaster_webhook_endpoints")
