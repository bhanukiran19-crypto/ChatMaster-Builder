"""Safe, deterministic workflow interpreter used by isolated simulations."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

MAX_EXECUTION_STEPS = 100


class WorkflowRuntimeError(Exception):
    pass


def start_simulation(
    graph: dict[str, Any],
    *,
    trigger_type: str,
    message: str | None,
    context: dict[str, Any],
) -> dict[str, Any]:
    state = {
        "status": "completed",
        "current_node_id": None,
        "context": deepcopy(context),
        "messages": [],
        "trace": [],
        "error": None,
        "steps_executed": 0,
    }
    nodes = graph.get("nodes", [])
    matches = [
        node
        for node in nodes
        if node.get("type") == "trigger"
        and _trigger_matches(node.get("data", {}), trigger_type, message)
    ]
    if not matches:
        state["status"] = "failed"
        state["error"] = "No trigger in this flow matches the simulation input."
        state["trace"].append(
            {
                "nodeId": "",
                "nodeType": "trigger",
                "status": "failed",
                "message": state["error"],
                "details": {"triggerType": trigger_type},
            }
        )
        return state

    _run_from(graph, matches[0]["id"], state)
    return state


def continue_simulation(
    graph: dict[str, Any],
    state: dict[str, Any],
    *,
    message: str | None,
    button_id: str | None,
) -> dict[str, Any]:
    next_state = deepcopy(state)
    current_id = next_state.get("current_node_id")
    nodes = {node["id"]: node for node in graph.get("nodes", [])}
    current = nodes.get(current_id)
    if current is None or current.get("type") != "message":
        raise WorkflowRuntimeError("The simulation is not waiting at a message step.")

    if button_id:
        buttons = current.get("data", {}).get("buttons", [])
        selected = next(
            (
                (index, button)
                for index, button in enumerate(buttons)
                if button.get("id") == button_id or button.get("label") == button_id
            ),
            None,
        )
        if selected is None:
            raise WorkflowRuntimeError("That reply button is not part of the current step.")
        index, button = selected
        handle = f"button:{button.get('id') or index}"
        target = button.get("targetId") or _next_node(graph, current_id, handle)
        next_state["context"]["lastButton"] = button.get("label", "")
    else:
        target = _next_node(graph, current_id, "next")
        next_state["context"]["lastMessage"] = message or ""

    if not target:
        next_state["status"] = "completed"
        next_state["current_node_id"] = None
        next_state["trace"].append(
            {
                "nodeId": current_id,
                "nodeType": "message",
                "status": "completed",
                "message": "No following step is connected.",
                "details": {},
            }
        )
        return next_state

    next_state["status"] = "completed"
    _run_from(graph, target, next_state)
    return next_state


def _trigger_matches(data: dict[str, Any], trigger_type: str, message: str | None) -> bool:
    if data.get("triggerType", "conversation_start") != trigger_type:
        return False
    if trigger_type == "keyword":
        normalized = (message or "").casefold()
        return any(
            keyword.casefold() in normalized
            for keyword in data.get("keywords", [])
            if isinstance(keyword, str) and keyword.strip()
        )
    if trigger_type == "incoming_message":
        return bool(message and message.strip())
    return trigger_type == "conversation_start"


def _run_from(graph: dict[str, Any], first_node_id: str, state: dict[str, Any]) -> None:
    nodes = {node["id"]: node for node in graph.get("nodes", [])}
    current_id: str | None = first_node_id
    state.setdefault("steps_executed", 0)

    while current_id:
        if state["steps_executed"] >= MAX_EXECUTION_STEPS:
            _fail(state, current_id, "Execution stopped after reaching the 100-step safety limit.")
            return
        state["steps_executed"] += 1

        node = nodes.get(current_id)
        if node is None:
            _fail(state, current_id, "The workflow points to a missing step.")
            return

        node_type = node.get("type")
        data = node.get("data", {})
        state["current_node_id"] = current_id

        if node_type == "trigger":
            _trace(state, node, "completed", "Trigger matched.", {})
            current_id = _next_node(graph, current_id, "next")
        elif node_type == "message":
            text = (data.get("text") or "").strip()
            if not text:
                _fail(state, current_id, "This message step has no text.")
                return
            buttons = data.get("buttons", []) if data.get("messageType") == "buttons" else []
            state["messages"].append(
                {
                    "nodeId": current_id,
                    "text": text,
                    "buttons": buttons,
                }
            )
            _trace(state, node, "awaiting_input", "Displayed a test message.", {})
            state["status"] = "awaiting_input"
            return
        elif node_type == "condition":
            try:
                result = _evaluate_condition(data, state["context"])
            except WorkflowRuntimeError as exc:
                _fail(state, current_id, str(exc))
                return
            branch = "true" if result else "false"
            _trace(
                state,
                node,
                "completed",
                f"Condition evaluated to {branch}.",
                {"branch": branch},
            )
            current_id = _next_node(graph, current_id, branch)
        elif node_type == "add_tag":
            tag_name = (data.get("tagName") or "").strip()
            if not tag_name:
                _fail(state, current_id, "The tag step needs a tag name.")
                return
            tags = state["context"].setdefault("tags", [])
            if not isinstance(tags, list):
                _fail(state, current_id, "Simulation context tags must be a list.")
                return
            if tag_name not in tags:
                tags.append(tag_name)
            _trace(state, node, "completed", f"Added tag '{tag_name}'.", {"tag": tag_name})
            current_id = _next_node(graph, current_id, "next")
        elif node_type == "update_field":
            field_name = (data.get("fieldName") or "").strip()
            if not field_name:
                _fail(state, current_id, "The contact-field step needs a field name.")
                return
            fields = state["context"].setdefault("contactFields", {})
            if not isinstance(fields, dict):
                _fail(state, current_id, "Simulation context contactFields must be an object.")
                return
            fields[field_name] = data.get("fieldValue") or ""
            _trace(
                state,
                node,
                "completed",
                f"Updated contact field '{field_name}'.",
                {"field": field_name},
            )
            current_id = _next_node(graph, current_id, "next")
        elif node_type == "delay":
            seconds = data.get("delaySeconds")
            if not isinstance(seconds, int) or seconds < 0:
                _fail(state, current_id, "The delay step needs a valid duration.")
                return
            _trace(
                state,
                node,
                "completed",
                "Delay recorded; the simulator does not wait in real time.",
                {"delaySeconds": seconds, "simulation": True},
            )
            current_id = _next_node(graph, current_id, "next")
        elif node_type == "ai_response":
            _fail(
                state,
                current_id,
                "AI responses are unavailable until an AI provider is configured.",
            )
            return
        elif node_type == "human_handoff":
            _trace(
                state,
                node,
                "waiting_for_agent",
                data.get("handoffNote") or "Simulation paused for a human agent.",
                {},
            )
            state["status"] = "waiting_for_agent"
            return
        elif node_type == "end":
            _trace(state, node, "completed", "Workflow ended.", {})
            state["status"] = "completed"
            state["current_node_id"] = None
            return
        else:
            _fail(state, current_id, f"Unsupported workflow step type: {node_type}.")
            return

    state["status"] = "completed"
    state["current_node_id"] = None


def _evaluate_condition(data: dict[str, Any], context: dict[str, Any]) -> bool:
    field = (data.get("conditionField") or "").strip()
    operator = data.get("conditionOperator")
    if not field or not operator:
        raise WorkflowRuntimeError("The condition step is not configured.")

    value: Any = context
    for part in field.split("."):
        value = value.get(part) if isinstance(value, dict) else None
    expected = data.get("conditionValue")
    if operator == "exists":
        return value is not None and value != ""
    if operator == "not_exists":
        return value is None or value == ""

    actual_text = str(value).casefold() if value is not None else ""
    expected_text = str(expected or "").casefold()
    if operator == "equals":
        return actual_text == expected_text
    if operator == "not_equals":
        return actual_text != expected_text
    if operator == "contains":
        if isinstance(value, list):
            return expected in value
        return expected_text in actual_text
    if operator == "not_contains":
        if isinstance(value, list):
            return expected not in value
        return expected_text not in actual_text
    raise WorkflowRuntimeError(f"Unsupported condition operator: {operator}.")


def _next_node(graph: dict[str, Any], source_id: str, handle: str) -> str | None:
    nodes = {node["id"]: node for node in graph.get("nodes", [])}
    source = nodes.get(source_id, {})
    data = source.get("data", {})
    if handle.startswith("button:"):
        button_id = handle.removeprefix("button:")
        buttons = data.get("buttons", [])
        button = next(
            (
                (index, item)
                for index, item in enumerate(buttons)
                if (item.get("id") or str(index)) == button_id
            ),
            None,
        )
        if button and button[1].get("targetId"):
            return button[1]["targetId"]

    for edge in graph.get("edges", []):
        if edge.get("source") != source_id:
            continue
        edge_handle = edge.get("sourceHandle") or edge.get("label") or "next"
        if edge_handle == handle:
            return edge.get("target")
    return None


def _trace(
    state: dict[str, Any],
    node: dict[str, Any],
    status: str,
    message: str,
    details: dict[str, Any],
) -> None:
    state["trace"].append(
        {
            "nodeId": node["id"],
            "nodeType": node["type"],
            "status": status,
            "message": message,
            "details": details,
        }
    )


def _fail(state: dict[str, Any], node_id: str, message: str) -> None:
    state["status"] = "failed"
    state["error"] = message
    state["trace"].append(
        {
            "nodeId": node_id,
            "nodeType": "error",
            "status": "failed",
            "message": message,
            "details": {},
        }
    )
