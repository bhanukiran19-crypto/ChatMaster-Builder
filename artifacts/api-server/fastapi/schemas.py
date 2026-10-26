from datetime import datetime
import json
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Role = Literal["owner", "admin", "agent"]
FlowStatus = Literal["draft", "published"]
NodeType = Literal[
    "trigger",
    "message",
    "condition",
    "add_tag",
    "update_field",
    "delay",
    "ai_response",
    "human_handoff",
    "end",
]
TriggerType = Literal["conversation_start", "keyword", "incoming_message"]
MessageType = Literal["text", "buttons"]
ConditionOperator = Literal[
    "equals", "not_equals", "contains", "not_contains", "exists", "not_exists"
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FlowPosition(StrictModel):
    x: float
    y: float


class FlowButton(StrictModel):
    id: str | None = Field(default=None, max_length=80)
    label: str = Field(min_length=1, max_length=80)
    targetId: str | None = Field(default=None, max_length=80)


class FlowNodeData(StrictModel):
    label: str = Field(min_length=1, max_length=120)
    text: str | None = Field(default=None, max_length=2000)
    condition: str | None = Field(default=None, max_length=500)
    buttons: list[FlowButton] = Field(default_factory=list, max_length=5)
    triggerType: TriggerType = "conversation_start"
    keywords: list[str] = Field(default_factory=list, max_length=20)
    messageType: MessageType = "text"
    conditionField: str | None = Field(default=None, max_length=160)
    conditionOperator: ConditionOperator | None = None
    conditionValue: str | None = Field(default=None, max_length=500)
    tagName: str | None = Field(default=None, max_length=80)
    fieldName: str | None = Field(default=None, max_length=120)
    fieldValue: str | None = Field(default=None, max_length=1000)
    delaySeconds: int | None = Field(default=None, ge=0, le=86400)
    aiPrompt: str | None = Field(default=None, max_length=2000)
    handoffNote: str | None = Field(default=None, max_length=1000)


class FlowNode(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    type: NodeType
    position: FlowPosition
    data: FlowNodeData


class FlowEdge(StrictModel):
    id: str = Field(min_length=1, max_length=160)
    source: str = Field(min_length=1, max_length=80)
    target: str = Field(min_length=1, max_length=80)
    label: str | None = Field(default=None, max_length=120)
    sourceHandle: str | None = Field(default=None, max_length=120)
    targetHandle: str | None = Field(default=None, max_length=120)


class FlowGraph(StrictModel):
    nodes: list[FlowNode] = Field(max_length=200)
    edges: list[FlowEdge] = Field(max_length=500)

    @model_validator(mode="after")
    def validate_references(self) -> "FlowGraph":
        node_ids = [node.id for node in self.nodes]
        if len(node_ids) != len(set(node_ids)):
            raise ValueError("Flow node IDs must be unique.")
        edge_ids = [edge.id for edge in self.edges]
        if len(edge_ids) != len(set(edge_ids)):
            raise ValueError("Flow edge IDs must be unique.")
        known_nodes = set(node_ids)
        for edge in self.edges:
            if edge.source not in known_nodes or edge.target not in known_nodes:
                raise ValueError("Every flow edge must connect existing nodes.")
            if edge.source == edge.target:
                raise ValueError("A flow step cannot connect to itself.")
        for node in self.nodes:
            for button in node.data.buttons:
                if button.targetId and button.targetId not in known_nodes:
                    raise ValueError("Every button target must reference an existing node.")
        nodes_by_id = {node.id: node for node in self.nodes}
        for edge in self.edges:
            source = nodes_by_id[edge.source]
            target = nodes_by_id[edge.target]
            if source.type == "end":
                raise ValueError("An end step cannot have outgoing connections.")
            if target.type == "trigger":
                raise ValueError("A trigger cannot have incoming connections.")
            if edge.sourceHandle:
                valid_handles = {"next"}
                if source.type == "condition":
                    valid_handles = {"true", "false"}
                elif source.type == "message" and source.data.messageType == "buttons":
                    valid_handles = {
                        f"button:{button.id or index}"
                        for index, button in enumerate(source.data.buttons)
                    }
                if edge.sourceHandle not in valid_handles:
                    raise ValueError(
                        f"Connection from '{source.data.label}' uses an unknown output."
                    )
        return self


def validate_publishable_graph(
    graph: FlowGraph,
    *,
    ai_provider_configured: bool = False,
) -> list[str]:
    """Return actionable validation issues without preventing draft saves."""
    issues: list[str] = []
    if not any(node.type == "trigger" for node in graph.nodes):
        issues.append("Add at least one start trigger.")
    if not any(node.type == "message" for node in graph.nodes):
        issues.append("Add at least one message step.")

    nodes_by_id = {node.id: node for node in graph.nodes}
    reachable: dict[str, set[str]] = {node.id: set() for node in graph.nodes}
    handles_by_source: dict[str, dict[str, int]] = {}
    for edge in graph.edges:
        source = nodes_by_id[edge.source]
        handle = edge.sourceHandle or edge.label or "next"
        reachable[edge.source].add(edge.target)
        handles = handles_by_source.setdefault(edge.source, {})
        handles[handle] = handles.get(handle, 0) + 1
    for node in graph.nodes:
        for button in node.data.buttons:
            if button.targetId:
                reachable[node.id].add(button.targetId)
    for source_id, handles in handles_by_source.items():
        for handle, count in handles.items():
            if count > 1:
                source_label = nodes_by_id[source_id].data.label
                issues.append(
                    f"Connect only one step to the '{handle}' output on '{source_label}'."
                )

    for node in graph.nodes:
        label = node.data.label
        if node.type == "trigger":
            if node.data.triggerType == "keyword" and not node.data.keywords:
                issues.append(f"Add a keyword to trigger '{label}'.")
            if not any(
                edge.source == node.id
                and (edge.sourceHandle or edge.label or "next") == "next"
                for edge in graph.edges
            ):
                issues.append(f"Connect trigger '{label}' to a step.")
        elif node.type == "message":
            if not (node.data.text or "").strip():
                issues.append(f"Add message text to '{label}'.")
            if node.data.messageType == "buttons":
                if not node.data.buttons:
                    issues.append(f"Add at least one reply button to '{label}'.")
                for index, button in enumerate(node.data.buttons):
                    handle = f"button:{button.id or index}"
                    has_route = bool(button.targetId) or any(
                        edge.source == node.id and edge.sourceHandle == handle
                        for edge in graph.edges
                    )
                    if not has_route:
                        issues.append(f"Connect the '{button.label}' button on '{label}'.")
        elif node.type == "condition":
            if not node.data.conditionField or not node.data.conditionOperator:
                issues.append(f"Configure the condition on '{label}'.")
            routes = {
                edge.sourceHandle or edge.label
                for edge in graph.edges
                if edge.source == node.id
            }
            if not {"true", "false"}.issubset(routes):
                issues.append(f"Connect both true and false paths from '{label}'.")
        elif node.type == "add_tag" and not (node.data.tagName or "").strip():
            issues.append(f"Choose a tag for '{label}'.")
        elif node.type == "update_field" and not (node.data.fieldName or "").strip():
            issues.append(f"Choose a contact field for '{label}'.")
        elif node.type == "delay" and node.data.delaySeconds is None:
            issues.append(f"Set a delay duration for '{label}'.")
        elif node.type == "ai_response" and not (node.data.aiPrompt or "").strip():
            issues.append(f"Add instructions for the AI step '{label}'.")
        elif node.type == "ai_response" and not ai_provider_configured:
            issues.append(
                f"Connect an AI provider before publishing '{label}'."
            )

    trigger_ids = {node.id for node in graph.nodes if node.type == "trigger"}
    seen = set(trigger_ids)
    pending = list(trigger_ids)
    while pending:
        current = pending.pop()
        for target in reachable.get(current, set()):
            if target not in seen:
                seen.add(target)
                pending.append(target)
    unreachable = [
        node.data.label
        for node in graph.nodes
        if node.type != "trigger" and node.id not in seen
    ]
    if unreachable:
        issues.append(
            "Connect every step to a start trigger: " + ", ".join(unreachable) + "."
        )

    return issues


class FlowInput(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    graph: FlowGraph

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Flow name cannot be blank.")
        return value


class FlowUpdate(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    status: FlowStatus | None = None
    graph: FlowGraph | None = None

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("Flow name cannot be blank.")
        return value

    @model_validator(mode="after")
    def has_changes(self) -> "FlowUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one flow field must be provided.")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("Flow name cannot be null.")
        if "status" in self.model_fields_set and self.status is None:
            raise ValueError("Flow status cannot be null.")
        if "graph" in self.model_fields_set and self.graph is None:
            raise ValueError("Flow graph cannot be null.")
        return self


class CurrentUser(BaseModel):
    userId: str
    email: str
    name: str
    workspaceId: UUID
    workspaceName: str
    role: Role


class FlowOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    description: str | None
    status: FlowStatus
    graph: FlowGraph
    draftVersion: int = Field(validation_alias="draft_version")
    publishedVersion: int = Field(validation_alias="published_version")
    createdAt: datetime = Field(validation_alias="created_at")
    updatedAt: datetime = Field(validation_alias="updated_at")


SimulationStatus = Literal[
    "awaiting_input", "waiting_for_agent", "completed", "failed"
]


class SimulationStartInput(StrictModel):
    triggerType: TriggerType = "conversation_start"
    message: str | None = Field(default=None, max_length=2000)
    context: dict = Field(default_factory=dict)

    @field_validator("context")
    @classmethod
    def context_size_is_bounded(cls, value: dict) -> dict:
        if len(json.dumps(value, separators=(",", ":"))) > 25000:
            raise ValueError("Simulation context must be smaller than 25 KB.")
        return value


class SimulationInput(StrictModel):
    message: str | None = Field(default=None, max_length=2000)
    buttonId: str | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def has_one_input(self) -> "SimulationInput":
        if bool(self.message and self.message.strip()) == bool(self.buttonId):
            raise ValueError("Provide exactly one visitor message or button choice.")
        return self


class FlowMessageOut(BaseModel):
    nodeId: str
    text: str
    buttons: list[FlowButton]


class FlowTraceOut(BaseModel):
    nodeId: str
    nodeType: str
    status: str
    message: str
    details: dict


class FlowExecutionOut(BaseModel):
    id: UUID
    flowId: UUID = Field(validation_alias="flow_id")
    mode: Literal["simulation"]
    status: SimulationStatus
    flowVersion: int = Field(validation_alias="flow_version")
    currentNodeId: str | None = Field(validation_alias="current_node_id")
    context: dict
    messages: list[FlowMessageOut]
    trace: list[FlowTraceOut]
    error: str | None
    createdAt: datetime = Field(validation_alias="created_at")
    updatedAt: datetime = Field(validation_alias="updated_at")


class FlowValidation(BaseModel):
    valid: bool
    issues: list[str]


class DashboardSummary(BaseModel):
    flowCount: int
    publishedFlowCount: int
    nodeCount: int
    recentFlows: list[FlowOut]


class DeleteFlowResult(BaseModel):
    deleted: bool
