from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Role = Literal["owner", "admin", "agent"]
FlowStatus = Literal["draft", "published"]
NodeType = Literal["trigger", "message", "condition"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FlowPosition(StrictModel):
    x: float
    y: float


class FlowButton(StrictModel):
    label: str = Field(min_length=1, max_length=80)
    targetId: str | None = Field(default=None, max_length=80)


class FlowNodeData(StrictModel):
    label: str = Field(min_length=1, max_length=120)
    text: str | None = Field(default=None, max_length=2000)
    condition: str | None = Field(default=None, max_length=500)
    buttons: list[FlowButton] = Field(default_factory=list, max_length=5)


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
        for node in self.nodes:
            for button in node.data.buttons:
                if button.targetId and button.targetId not in known_nodes:
                    raise ValueError("Every button target must reference an existing node.")
        return self


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
    createdAt: datetime = Field(validation_alias="created_at")
    updatedAt: datetime = Field(validation_alias="updated_at")


class DashboardSummary(BaseModel):
    flowCount: int
    publishedFlowCount: int
    nodeCount: int
    recentFlows: list[FlowOut]


class DeleteFlowResult(BaseModel):
    deleted: bool
