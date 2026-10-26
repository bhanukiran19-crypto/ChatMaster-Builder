from uuid import UUID

from sqlalchemy import select

import database
from models import Flow

OWNER = {
    "x-chatmaster-user-id": "runtime_owner",
    "x-chatmaster-user-email": "owner@example.test",
    "x-chatmaster-user-name": "Runtime Owner",
}
AGENT = {
    "x-chatmaster-user-id": "runtime_other",
    "x-chatmaster-user-email": "other@example.test",
    "x-chatmaster-user-name": "Other Workspace",
}

BUTTON_FLOW = {
    "nodes": [
        {
            "id": "start",
            "type": "trigger",
            "position": {"x": 0, "y": 0},
            "data": {"label": "Start"},
        },
        {
            "id": "choose",
            "type": "message",
            "position": {"x": 0, "y": 100},
            "data": {
                "label": "Choose a topic",
                "text": "What can we help with?",
                "messageType": "buttons",
                "buttons": [{"id": "orders", "label": "Orders"}],
            },
        },
        {
            "id": "tag",
            "type": "add_tag",
            "position": {"x": 0, "y": 200},
            "data": {"label": "Mark order question", "tagName": "order-question"},
        },
        {
            "id": "reply",
            "type": "message",
            "position": {"x": 0, "y": 300},
            "data": {"label": "Reply", "text": "We can help with your order."},
        },
        {
            "id": "end",
            "type": "end",
            "position": {"x": 0, "y": 400},
            "data": {"label": "Finish"},
        },
    ],
    "edges": [
        {"id": "start-choose", "source": "start", "target": "choose"},
        {
            "id": "choose-tag",
            "source": "choose",
            "target": "tag",
            "sourceHandle": "button:orders",
        },
        {"id": "tag-reply", "source": "tag", "target": "reply"},
        {"id": "reply-end", "source": "reply", "target": "end"},
    ],
}


def test_simulation_runs_buttons_and_contact_actions_without_sending_messages(api_client):
    created = api_client.post(
        "/flows",
        headers=OWNER,
        json={"name": "Button flow", "graph": BUTTON_FLOW},
    )
    assert created.status_code == 201
    flow = created.json()

    started = api_client.post(
        f"/flows/{flow['id']}/simulations",
        headers=OWNER,
        json={"triggerType": "conversation_start", "context": {"tags": []}},
    )
    assert started.status_code == 201
    simulation = started.json()
    assert simulation["mode"] == "simulation"
    assert simulation["status"] == "awaiting_input"
    assert simulation["messages"][0]["text"] == "What can we help with?"

    continued = api_client.post(
        f"/simulations/{simulation['id']}/input",
        headers=OWNER,
        json={"buttonId": "orders"},
    )
    assert continued.status_code == 200
    state = continued.json()
    assert state["status"] == "awaiting_input"
    assert state["context"]["tags"] == ["order-question"]
    assert state["messages"][-1]["text"] == "We can help with your order."

    completed = api_client.post(
        f"/simulations/{simulation['id']}/input",
        headers=OWNER,
        json={"message": "Thanks"},
    )
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"


def test_simulations_are_workspace_scoped(api_client):
    created = api_client.post(
        "/flows",
        headers=OWNER,
        json={"name": "Private flow", "graph": BUTTON_FLOW},
    )
    simulation = api_client.post(
        f"/flows/{created.json()['id']}/simulations",
        headers=OWNER,
        json={},
    ).json()

    response = api_client.get(f"/simulations/{simulation['id']}", headers=AGENT)
    assert response.status_code == 404


def test_publish_validation_and_immutable_published_snapshot(api_client):
    created = api_client.post(
        "/flows",
        headers=OWNER,
        json={"name": "Versioned flow", "graph": BUTTON_FLOW},
    )
    flow_id = created.json()["id"]
    assert created.json()["draftVersion"] == 1
    assert created.json()["publishedVersion"] == 0

    published = api_client.patch(
        f"/flows/{flow_id}",
        headers=OWNER,
        json={"status": "published"},
    )
    assert published.status_code == 200
    assert published.json()["publishedVersion"] == 1

    changed_graph = {**BUTTON_FLOW}
    changed_graph["nodes"] = [
        {
            **node,
            "data": {**node["data"], **({"text": "Updated reply."} if node["id"] == "reply" else {})},
        }
        for node in BUTTON_FLOW["nodes"]
    ]
    staged = api_client.patch(
        f"/flows/{flow_id}",
        headers=OWNER,
        json={"graph": changed_graph},
    )
    assert staged.status_code == 200
    assert staged.json()["status"] == "draft"
    assert staged.json()["draftVersion"] == 2
    assert staged.json()["publishedVersion"] == 1

    session = database.SessionLocal()
    try:
        stored = session.scalar(select(Flow).where(Flow.id == UUID(flow_id)))
        assert stored is not None
        assert stored.published_graph["nodes"][3]["data"]["text"] == "We can help with your order."
    finally:
        session.close()

    republished = api_client.patch(
        f"/flows/{flow_id}",
        headers=OWNER,
        json={"status": "published"},
    )
    assert republished.status_code == 200
    assert republished.json()["publishedVersion"] == 2


def test_publish_validation_returns_actionable_issues(api_client):
    created = api_client.post(
        "/flows",
        headers=OWNER,
        json={"name": "Incomplete", "graph": {"nodes": [], "edges": []}},
    )
    flow_id = created.json()["id"]
    result = api_client.post(
        f"/flows/{flow_id}/validate",
        headers=OWNER,
        json={"nodes": [], "edges": []},
    )
    assert result.status_code == 200
    assert result.json()["valid"] is False
    assert "Add at least one start trigger." in result.json()["issues"]

    rejected = api_client.patch(
        f"/flows/{flow_id}",
        headers=OWNER,
        json={"status": "published"},
    )
    assert rejected.status_code == 400
    assert rejected.json()["detail"]["issues"]


def test_ai_step_fails_explicitly_without_a_configured_provider(api_client):
    graph = {
        "nodes": [
            {
                "id": "start",
                "type": "trigger",
                "position": {"x": 0, "y": 0},
                "data": {"label": "Start"},
            },
            {
                "id": "ai",
                "type": "ai_response",
                "position": {"x": 0, "y": 100},
                "data": {"label": "Answer", "aiPrompt": "Use the knowledge base."},
            },
        ],
        "edges": [{"id": "start-ai", "source": "start", "target": "ai"}],
    }
    created = api_client.post(
        "/flows",
        headers=OWNER,
        json={"name": "AI flow", "graph": graph},
    )
    simulation = api_client.post(
        f"/flows/{created.json()['id']}/simulations",
        headers=OWNER,
        json={},
    )
    assert simulation.status_code == 201
    assert simulation.json()["status"] == "failed"
    assert "AI provider is configured" in simulation.json()["error"]
    assert simulation.json()["messages"] == []
