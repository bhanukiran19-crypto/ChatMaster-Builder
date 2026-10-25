from sqlalchemy import select

import database
from models import AuditEvent, WorkspaceMember

OWNER = {"x-chatmaster-user-id": "user_owner", "x-chatmaster-user-email": "owner@example.test", "x-chatmaster-user-name": "Workspace Owner"}
AGENT = {"x-chatmaster-user-id": "user_agent", "x-chatmaster-user-email": "agent@example.test", "x-chatmaster-user-name": "Workspace Agent"}

STARTER_GRAPH = {
    "nodes": [
        {
            "id": "trigger-1",
            "type": "trigger",
            "position": {"x": 80, "y": 80},
            "data": {"label": "Conversation starts", "text": None, "condition": None, "buttons": []},
        },
        {
            "id": "message-1",
            "type": "message",
            "position": {"x": 80, "y": 240},
            "data": {
                "label": "Welcome",
                "text": "How can we help?",
                "condition": None,
                "buttons": [{"label": "Orders", "targetId": None}],
            },
        },
    ],
    "edges": [{"id": "edge-trigger-message", "source": "trigger-1", "target": "message-1", "label": None}],
}


def test_requires_a_verified_gateway_identity(api_client):
    response = api_client.get("/auth/me")
    assert response.status_code == 401


def test_first_authenticated_request_creates_tenant_owner(api_client):
    response = api_client.get("/auth/me", headers=OWNER)
    assert response.status_code == 200
    assert response.json()["role"] == "owner"
    assert response.json()["workspaceName"] == "Workspace Owner's workspace"


def test_flow_crud_is_tenant_scoped_and_audited(api_client):
    created = api_client.post(
        "/flows",
        headers=OWNER,
        json={"name": "Welcome flow", "description": "First reply", "graph": STARTER_GRAPH},
    )
    assert created.status_code == 201
    flow = created.json()

    published = api_client.patch(
        f"/flows/{flow['id']}",
        headers=OWNER,
        json={"status": "published"},
    )
    assert published.status_code == 200
    assert published.json()["status"] == "published"

    summary = api_client.get("/dashboard/summary", headers=OWNER).json()
    assert (summary["flowCount"], summary["publishedFlowCount"], summary["nodeCount"]) == (1, 1, 2)

    foreign_get = api_client.get(f"/flows/{flow['id']}", headers=AGENT)
    foreign_list = api_client.get("/flows", headers=AGENT)
    assert foreign_get.status_code == 404
    assert foreign_list.status_code == 200
    assert foreign_list.json() == []

    session = database_session()
    try:
        actions = list(session.scalars(select(AuditEvent.action)))
        assert set(actions) == {"flow.created", "flow.updated"}
    finally:
        session.close()

    deleted = api_client.delete(f"/flows/{flow['id']}", headers=OWNER)
    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": True}


def test_agent_members_are_read_only(api_client):
    owner = api_client.get("/auth/me", headers=OWNER).json()
    session = database_session()
    try:
        member = session.scalar(
            select(WorkspaceMember).where(
                WorkspaceMember.clerk_user_id == OWNER["x-chatmaster-user-id"],
            )
        )
        assert member is not None
        session.add(
            WorkspaceMember(
                workspace_id=member.workspace_id,
                clerk_user_id=AGENT["x-chatmaster-user-id"],
                role="agent",
            )
        )
        session.commit()
    finally:
        session.close()

    response = api_client.post(
        "/flows",
        headers=AGENT,
        json={"name": "Read-only attempt", "graph": {"nodes": [], "edges": []}},
    )
    assert response.status_code == 403


def test_flow_rejects_edges_that_reference_missing_nodes(api_client):
    response = api_client.post(
        "/flows",
        headers=OWNER,
        json={
            "name": "Invalid flow",
            "graph": {
                "nodes": [],
                "edges": [{"id": "bad-edge", "source": "missing-a", "target": "missing-b"}],
            },
        },
    )
    assert response.status_code == 422


def database_session():
    return database.SessionLocal()
