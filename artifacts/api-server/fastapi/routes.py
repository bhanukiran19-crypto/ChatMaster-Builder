import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_session
from models import AuditEvent, Flow, Workspace, WorkspaceMember
from schemas import (
    CurrentUser,
    DashboardSummary,
    DeleteFlowResult,
    FlowInput,
    FlowOut,
    FlowUpdate,
)

router = APIRouter()
SessionDep = Annotated[Session, Depends(get_session)]


class Actor:
    def __init__(self, member: WorkspaceMember, workspace: Workspace, user_id: str, email: str, name: str):
        self.member = member
        self.workspace = workspace
        self.user_id = user_id
        self.email = email
        self.name = name


def current_actor(
    session: SessionDep,
    user_id: Annotated[str | None, Header(alias="x-chatmaster-user-id")] = None,
    email: Annotated[str | None, Header(alias="x-chatmaster-user-email")] = None,
    name: Annotated[str | None, Header(alias="x-chatmaster-user-name")] = None,
) -> Actor:
    if not user_id or len(user_id) > 255:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")
    clean_email = (email or "").strip()[:320]
    clean_name = (name or "").strip()[:120]
    member = session.scalar(
        select(WorkspaceMember)
        .where(WorkspaceMember.clerk_user_id == user_id)
        .order_by(WorkspaceMember.created_at.asc())
    )
    if member is None:
        workspace_name = (clean_name or clean_email.split("@")[0] or "My")[:100]
        workspace = Workspace(name=f"{workspace_name}'s workspace")
        session.add(workspace)
        session.flush()
        member = WorkspaceMember(workspace_id=workspace.id, clerk_user_id=user_id, role="owner")
        session.add(member)
        session.commit()
        session.refresh(member)
    workspace = session.get(Workspace, member.workspace_id)
    if workspace is None:
        raise HTTPException(status_code=500, detail="Workspace membership is invalid.")
    return Actor(member, workspace, user_id, clean_email, clean_name or clean_email or "ChatMaster member")


ActorDep = Annotated[Actor, Depends(current_actor)]


def require_editor(actor: ActorDep) -> None:
    if actor.member.role not in {"owner", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Workspace editor access required.")


def audit(
    session: Session,
    actor: Actor,
    action: str,
    entity_id: uuid.UUID,
    details: dict,
) -> None:
    session.add(
        AuditEvent(
            workspace_id=actor.workspace.id,
            actor_clerk_user_id=actor.user_id,
            action=action,
            entity_type="flow",
            entity_id=str(entity_id),
            details=details,
        )
    )


def workspace_flow(session: Session, actor: Actor, flow_id: uuid.UUID) -> Flow:
    flow = session.scalar(
        select(Flow).where(
            Flow.id == flow_id,
            Flow.workspace_id == actor.workspace.id,
        )
    )
    if flow is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flow not found.")
    return flow


@router.get("/auth/me", response_model=CurrentUser)
def get_current_user(actor: ActorDep) -> CurrentUser:
    return CurrentUser(
        userId=actor.user_id,
        email=actor.email,
        name=actor.name,
        workspaceId=actor.workspace.id,
        workspaceName=actor.workspace.name,
        role=actor.member.role,
    )


@router.get("/dashboard/summary", response_model=DashboardSummary)
def get_dashboard_summary(session: SessionDep, actor: ActorDep) -> DashboardSummary:
    flows = list(
        session.scalars(
            select(Flow)
            .where(Flow.workspace_id == actor.workspace.id)
            .order_by(Flow.updated_at.desc())
        )
    )
    return DashboardSummary(
        flowCount=len(flows),
        publishedFlowCount=sum(flow.status == "published" for flow in flows),
        nodeCount=sum(len((flow.graph or {}).get("nodes", [])) for flow in flows),
        recentFlows=[FlowOut.model_validate(flow) for flow in flows[:5]],
    )


@router.get("/flows", response_model=list[FlowOut])
def list_flows(session: SessionDep, actor: ActorDep) -> list[Flow]:
    return list(
        session.scalars(
            select(Flow)
            .where(Flow.workspace_id == actor.workspace.id)
            .order_by(Flow.updated_at.desc())
        )
    )


@router.post("/flows", response_model=FlowOut, status_code=status.HTTP_201_CREATED)
def create_flow(
    payload: FlowInput,
    session: SessionDep,
    actor: ActorDep,
    _editor: Annotated[None, Depends(require_editor)],
) -> Flow:
    flow = Flow(
        workspace_id=actor.workspace.id,
        name=payload.name,
        description=payload.description,
        graph=payload.graph.model_dump(mode="json"),
    )
    session.add(flow)
    session.flush()
    audit(session, actor, "flow.created", flow.id, {"name": flow.name})
    session.commit()
    session.refresh(flow)
    return flow


@router.get("/flows/{flow_id}", response_model=FlowOut)
def get_flow(flow_id: uuid.UUID, session: SessionDep, actor: ActorDep) -> Flow:
    return workspace_flow(session, actor, flow_id)


@router.patch("/flows/{flow_id}", response_model=FlowOut)
def update_flow(
    flow_id: uuid.UUID,
    payload: FlowUpdate,
    session: SessionDep,
    actor: ActorDep,
    _editor: Annotated[None, Depends(require_editor)],
) -> Flow:
    flow = workspace_flow(session, actor, flow_id)
    changes = payload.model_dump(exclude_unset=True, mode="json")
    for field, value in changes.items():
        if field == "graph" and payload.graph is not None:
            value = payload.graph.model_dump(mode="json")
        setattr(flow, field, value)
    if flow.status == "published":
        node_types = {node.get("type") for node in (flow.graph or {}).get("nodes", [])}
        if "trigger" not in node_types or "message" not in node_types:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A published flow needs at least one trigger and one message node.",
            )
    audit(session, actor, "flow.updated", flow.id, {"fields": sorted(changes)})
    session.commit()
    session.refresh(flow)
    return flow


@router.delete("/flows/{flow_id}", response_model=DeleteFlowResult)
def delete_flow(
    flow_id: uuid.UUID,
    session: SessionDep,
    actor: ActorDep,
    _editor: Annotated[None, Depends(require_editor)],
) -> DeleteFlowResult:
    flow = workspace_flow(session, actor, flow_id)
    audit(session, actor, "flow.deleted", flow.id, {"name": flow.name})
    session.delete(flow)
    session.commit()
    return DeleteFlowResult(deleted=True)
