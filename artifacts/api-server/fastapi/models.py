import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    JSON,
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
