import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    LargeBinary,
    String,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

JSON_DOCUMENT = JSON().with_variant(JSONB, "postgresql")


class Base(DeclarativeBase):
    pass


class Workspace(Base):
    __tablename__ = "chatmaster_workspaces"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    members: Mapped[list["WorkspaceMember"]] = relationship(
        back_populates="workspace", cascade="all, delete-orphan"
    )
    flows: Mapped[list["Flow"]] = relationship(
        back_populates="workspace", cascade="all, delete-orphan"
    )


class WorkspaceMember(Base):
    __tablename__ = "chatmaster_workspace_members"
    __table_args__ = (
        UniqueConstraint("workspace_id", "clerk_user_id", name="uq_chatmaster_member_workspace_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("chatmaster_workspaces.id", ondelete="CASCADE"), nullable=False
    )
    clerk_user_id: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="owner")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    workspace: Mapped[Workspace] = relationship(back_populates="members")


class Flow(Base):
    __tablename__ = "chatmaster_flows"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("chatmaster_workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    graph: Mapped[dict] = mapped_column(JSON_DOCUMENT, nullable=False, default=lambda: {"nodes": [], "edges": []})
    published_graph: Mapped[dict | None] = mapped_column(JSON_DOCUMENT, nullable=True)
    draft_version: Mapped[int] = mapped_column(nullable=False, default=1)
    published_version: Mapped[int] = mapped_column(nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    workspace: Mapped[Workspace] = relationship(back_populates="flows")
    executions: Mapped[list["FlowExecution"]] = relationship(
        back_populates="flow", cascade="all, delete-orphan"
    )


class FlowExecution(Base):
    __tablename__ = "chatmaster_flow_executions"
    __table_args__ = ()

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("chatmaster_workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    flow_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("chatmaster_flows.id", ondelete="CASCADE"), index=True, nullable=False
    )
    mode: Mapped[str] = mapped_column(String(20), nullable=False, default="simulation")
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="awaiting_input")
    flow_version: Mapped[int] = mapped_column(nullable=False)
    steps_executed: Mapped[int] = mapped_column(nullable=False, default=0)
    graph_snapshot: Mapped[dict] = mapped_column(JSON_DOCUMENT, nullable=False)
    current_node_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    context: Mapped[dict] = mapped_column(JSON_DOCUMENT, nullable=False, default=dict)
    messages: Mapped[list] = mapped_column(JSON_DOCUMENT, nullable=False, default=list)
    trace: Mapped[list] = mapped_column(JSON_DOCUMENT, nullable=False, default=list)
    error: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    flow: Mapped[Flow] = relationship(back_populates="executions")


class AuditEvent(Base):
    __tablename__ = "chatmaster_audit_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("chatmaster_workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    actor_clerk_user_id: Mapped[str] = mapped_column(String(255), nullable=False)
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(80), nullable=False)
    details: Mapped[dict] = mapped_column(JSON_DOCUMENT, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class WebhookEndpoint(Base):
    __tablename__ = "chatmaster_webhook_endpoints"
    __table_args__ = (
        CheckConstraint(
            "(direction = 'incoming' AND url IS NULL) OR "
            "(direction = 'outgoing' AND url IS NOT NULL)",
            name="ck_chatmaster_webhook_endpoint_direction_url",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("chatmaster_workspaces.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    direction: Mapped[str] = mapped_column(String(20), nullable=False)
    url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    subscriptions: Mapped[list["WebhookSubscription"]] = relationship(
        back_populates="endpoint", cascade="all, delete-orphan"
    )
    signing_secret: Mapped["WebhookSigningSecret | None"] = relationship(
        back_populates="endpoint", cascade="all, delete-orphan", uselist=False
    )
    deliveries: Mapped[list["WebhookDelivery"]] = relationship(
        back_populates="endpoint", cascade="all, delete-orphan"
    )


class WebhookSubscription(Base):
    __tablename__ = "chatmaster_webhook_subscriptions"
    __table_args__ = (
        UniqueConstraint("endpoint_id", "event_type", name="uq_chatmaster_webhook_subscription"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    endpoint_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("chatmaster_webhook_endpoints.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    event_type: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    endpoint: Mapped[WebhookEndpoint] = relationship(back_populates="subscriptions")


class WebhookSigningSecret(Base):
    __tablename__ = "chatmaster_webhook_signing_secrets"

    endpoint_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("chatmaster_webhook_endpoints.id", ondelete="CASCADE"),
        primary_key=True,
    )
    secret_reference: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), unique=True, nullable=False, default=uuid.uuid4
    )
    encrypted_secret: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    nonce: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    key_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    endpoint: Mapped[WebhookEndpoint] = relationship(back_populates="signing_secret")


class WebhookEvent(Base):
    __tablename__ = "chatmaster_webhook_events"
    __table_args__ = (
        UniqueConstraint(
            "source_endpoint_id",
            "source_event_id",
            name="uq_chatmaster_webhook_source_event",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("chatmaster_workspaces.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    source_endpoint_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("chatmaster_webhook_endpoints.id", ondelete="SET NULL"),
        nullable=True,
    )
    source_event_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    event_type: Mapped[str] = mapped_column(String(120), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON_DOCUMENT, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    deliveries: Mapped[list["WebhookDelivery"]] = relationship(
        back_populates="event", cascade="all, delete-orphan"
    )


class WebhookDelivery(Base):
    __tablename__ = "chatmaster_webhook_deliveries"
    __table_args__ = (
        UniqueConstraint("endpoint_id", "event_id", name="uq_chatmaster_webhook_delivery"),
        Index("ix_chatmaster_webhook_delivery_due", "status", "next_attempt_at"),
        CheckConstraint(
            "status IN ('pending', 'delivering', 'delivered', 'failed', 'cancelled')",
            name="ck_chatmaster_webhook_delivery_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("chatmaster_workspaces.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    endpoint_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("chatmaster_webhook_endpoints.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    event_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("chatmaster_webhook_events.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, server_default=func.now()
    )
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    endpoint: Mapped[WebhookEndpoint] = relationship(back_populates="deliveries")
    event: Mapped[WebhookEvent] = relationship(back_populates="deliveries")
    attempts: Mapped[list["WebhookDeliveryAttempt"]] = relationship(
        back_populates="delivery", cascade="all, delete-orphan", order_by="WebhookDeliveryAttempt.attempt_number"
    )


class WebhookDeliveryAttempt(Base):
    __tablename__ = "chatmaster_webhook_delivery_attempts"
    __table_args__ = (
        UniqueConstraint("delivery_id", "attempt_number", name="uq_chatmaster_webhook_attempt_number"),
        CheckConstraint(
            "status IN ('in_progress', 'succeeded', 'failed')",
            name="ck_chatmaster_webhook_attempt_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    delivery_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("chatmaster_webhook_deliveries.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    request_started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    response_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(500), nullable=True)

    delivery: Mapped[WebhookDelivery] = relationship(back_populates="attempts")
