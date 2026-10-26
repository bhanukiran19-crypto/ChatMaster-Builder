import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_session
from models import AuditEvent, Flow, FlowExecution, Workspace, WorkspaceMember
from schemas import (
    CurrentUser,
    DashboardSummary,
    DeleteFlowResult,
    FlowExecutionOut,
    FlowGraph,
    FlowInput,
    FlowOut,
    FlowUpdate,
    FlowValidation,
    SimulationInput,
    SimulationStartInput,
    validate_publishable_graph,
)
from workflow_engine import (
    WorkflowRuntimeError,
    continue_simulation,
    start_simulation,
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
        draft_version=1,
        published_version=0,
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
    changed_fields = set(changes)
    requested_status = changes.pop("status", None)
    graph_changed = "graph" in changes
    for field, value in changes.items():
        if field == "graph" and payload.graph is not None:
            value = payload.graph.model_dump(mode="json")
        setattr(flow, field, value)

    if graph_changed:
        flow.draft_version += 1

    if requested_status == "published":
        graph = FlowGraph.model_validate(flow.graph)
        issues = validate_publishable_graph(graph)
        if issues:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"message": "The flow needs changes before it can be published.", "issues": issues},
            )
        flow.published_graph = graph.model_dump(mode="json")
        flow.published_version += 1
        flow.status = "published"
    elif requested_status == "draft":
        flow.status = "draft"
    elif graph_changed and flow.status == "published":
        # Editing a live flow stages a draft; existing executions retain the
        # immutable published snapshot until the owner publishes again.
        flow.status = "draft"

    audit(session, actor, "flow.updated", flow.id, {"fields": sorted(changed_fields)})
    session.commit()
    session.refresh(flow)
    return flow


@router.post("/flows/{flow_id}/validate", response_model=FlowValidation)
def validate_flow(
    flow_id: uuid.UUID,
    graph: FlowGraph,
    session: SessionDep,
    actor: ActorDep,
) -> FlowValidation:
    workspace_flow(session, actor, flow_id)
    issues = validate_publishable_graph(graph)
    return FlowValidation(valid=not issues, issues=issues)


@router.post(
    "/flows/{flow_id}/simulations",
    response_model=FlowExecutionOut,
    status_code=status.HTTP_201_CREATED,
)
def start_flow_simulation(
    flow_id: uuid.UUID,
    payload: SimulationStartInput,
    session: SessionDep,
    actor: ActorDep,
) -> FlowExecution:
    flow = workspace_flow(session, actor, flow_id)
    graph = FlowGraph.model_validate(flow.graph)
    state = start_simulation(
        graph.model_dump(mode="json"),
        trigger_type=payload.triggerType,
        message=payload.message,
        context=payload.context,
    )
    execution = FlowExecution(
        workspace_id=actor.workspace.id,
        flow_id=flow.id,
        mode="simulation",
        status=state["status"],
        flow_version=flow.draft_version,
        steps_executed=state["steps_executed"],
        graph_snapshot=graph.model_dump(mode="json"),
        current_node_id=state["current_node_id"],
        context=state["context"],
        messages=state["messages"],
        trace=state["trace"],
        error=state["error"],
    )
    session.add(execution)
    audit(
        session,
        actor,
        "flow.simulation_started",
        execution.id,
        {"flowId": str(flow.id), "flowVersion": flow.draft_version},
    )
    session.commit()
    session.refresh(execution)
    return execution


def workspace_simulation(
    session: Session,
    actor: Actor,
    simulation_id: uuid.UUID,
) -> FlowExecution:
    execution = session.scalar(
        select(FlowExecution).where(
            FlowExecution.id == simulation_id,
            FlowExecution.workspace_id == actor.workspace.id,
            FlowExecution.mode == "simulation",
        )
    )
    if execution is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Simulation not found.")
    return execution


@router.get("/simulations/{simulation_id}", response_model=FlowExecutionOut)
def get_flow_simulation(
    simulation_id: uuid.UUID,
    session: SessionDep,
    actor: ActorDep,
) -> FlowExecution:
    return workspace_simulation(session, actor, simulation_id)


@router.post("/simulations/{simulation_id}/input", response_model=FlowExecutionOut)
def send_simulation_input(
    simulation_id: uuid.UUID,
    payload: SimulationInput,
    session: SessionDep,
    actor: ActorDep,
) -> FlowExecution:
    execution = workspace_simulation(session, actor, simulation_id)
    if execution.status != "awaiting_input":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This simulation is not waiting for visitor input.",
        )
    try:
        state = continue_simulation(
            execution.graph_snapshot,
            {
                "status": execution.status,
                "current_node_id": execution.current_node_id,
                "context": execution.context,
                "messages": execution.messages,
                "trace": execution.trace,
                "error": execution.error,
                "steps_executed": execution.steps_executed,
            },
            message=payload.message,
            button_id=payload.buttonId,
        )
    except WorkflowRuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    execution.status = state["status"]
    execution.current_node_id = state["current_node_id"]
    execution.context = state["context"]
    execution.messages = state["messages"]
    execution.trace = state["trace"]
    execution.error = state["error"]
    execution.steps_executed = state["steps_executed"]
    audit(
        session,
        actor,
        "flow.simulation_input",
        execution.id,
        {"inputType": "button" if payload.buttonId else "message"},
    )
    session.commit()
    session.refresh(execution)
    return execution


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
