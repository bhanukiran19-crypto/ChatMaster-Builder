import asyncio
import json
import socket
import time
from uuid import UUID

import httpcore
import httpx
import pytest
from sqlalchemy import select

import database
import webhook_routes
import webhook_security
import webhook_service
from models import (
    WebhookDelivery,
    WebhookDeliveryAttempt,
    WebhookEvent,
)
from test_api import OWNER, STARTER_GRAPH


OUTGOING_URL = "https://hooks.example.org/chatmaster"


@pytest.fixture(autouse=True)
def webhook_encryption_key(monkeypatch):
    monkeypatch.setenv("WEBHOOK_ENCRYPTION_KEY", "test-webhook-encryption-key-value-32-bytes")


def _create_endpoint(api_client, monkeypatch, *, direction="outgoing", event_types=None):
    monkeypatch.setattr(
        webhook_routes,
        "validate_https_endpoint_url",
        lambda value: value,
    )
    response = api_client.post(
        "/webhooks/endpoints",
        headers=OWNER,
        json={
            "name": "Production integration",
            "direction": direction,
            "url": OUTGOING_URL if direction == "outgoing" else None,
            "eventTypes": event_types or [],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _signed_inbound_request(
    api_client,
    endpoint_id: str,
    secret: str,
    event_id: str,
    *,
    timestamp: str | None = None,
    signature: str | None = None,
    body: bytes | None = None,
):
    timestamp = timestamp or str(int(time.time()))
    body = body or json.dumps(
        {
            "id": event_id,
            "type": "provider.order.updated",
            "data": {"orderId": "order-42", "state": "ready"},
        },
        separators=(",", ":"),
    ).encode()
    signature = signature or webhook_security.signature_for(secret, timestamp, body)
    return api_client.post(
        f"/webhooks/incoming/{endpoint_id}",
        content=body,
        headers={
            "content-type": "application/json",
            "x-chatmaster-timestamp": timestamp,
            "x-chatmaster-signature": signature,
        },
    )


def _run(coroutine):
    return asyncio.run(coroutine)


def test_event_type_catalog_lists_only_implemented_events(api_client):
    response = api_client.get("/webhooks/events", headers=OWNER)
    assert response.status_code == 200
    event_types = {event["eventType"] for event in response.json()}
    assert event_types == {"flow.published", "webhook.incoming.received"}


def test_publishing_flow_atomically_queues_a_real_delivery(api_client, monkeypatch):
    endpoint = _create_endpoint(
        api_client,
        monkeypatch,
        event_types=["flow.published"],
    )["endpoint"]
    flow = api_client.post(
        "/flows",
        headers=OWNER,
        json={"name": "Support flow", "graph": STARTER_GRAPH},
    ).json()

    published = api_client.patch(
        f"/flows/{flow['id']}",
        headers=OWNER,
        json={"status": "published"},
    )
    assert published.status_code == 200

    with database.SessionLocal() as session:
        event = session.scalar(
            select(WebhookEvent).where(WebhookEvent.event_type == "flow.published")
        )
        delivery = session.scalar(
            select(WebhookDelivery).where(WebhookDelivery.endpoint_id == endpoint["id"])
        )
        assert event is not None
        assert event.payload["data"]["flowId"] == flow["id"]
        assert event.payload["data"]["version"] == 1
        assert delivery is not None
        assert delivery.event_id == event.id
        assert delivery.status == "pending"


def test_outgoing_delivery_signs_payload_and_manual_retry_is_recorded(
    api_client, monkeypatch
):
    created = _create_endpoint(api_client, monkeypatch)
    endpoint = created["endpoint"]
    signing_secret = created["signingSecret"]
    listed = api_client.get("/webhooks/endpoints", headers=OWNER).json()
    assert "signingSecret" not in listed[0]
    assert listed[0]["secretReference"] == endpoint["secretReference"]

    queued = api_client.post(
        f"/webhooks/endpoints/{endpoint['id']}/test",
        headers=OWNER,
    )
    assert queued.status_code == 202
    delivery_id = queued.json()["id"]

    observed = []
    response_codes = iter([503, 202])

    def handler(request: httpx.Request) -> httpx.Response:
        body = request.content
        timestamp = request.headers["X-ChatMaster-Timestamp"]
        observed.append(
            {
                "body": body,
                "event": request.headers["X-ChatMaster-Event"],
                "delivery": request.headers["X-ChatMaster-Delivery"],
                "signature": request.headers["X-ChatMaster-Signature"],
                "timestamp": timestamp,
            }
        )
        return httpx.Response(next(response_codes), request=request)

    transport_factory = lambda: httpx.MockTransport(handler)
    monkeypatch.setattr(webhook_service, "MAX_AUTOMATIC_RETRIES", 0)

    assert _run(webhook_service.dispatch_one(transport_factory=transport_factory))
    first_history = api_client.get(
        f"/webhooks/deliveries?endpointId={endpoint['id']}",
        headers=OWNER,
    )
    assert first_history.status_code == 200
    first = first_history.json()[0]
    assert first["status"] == "failed"
    assert first["httpStatus"] == 503
    assert first["attempts"][0]["status"] == "failed"

    first_request = observed[0]
    assert first_request["event"] == "webhook.test"
    assert first_request["delivery"] == delivery_id
    assert first_request["signature"] == webhook_security.signature_for(
        signing_secret,
        first_request["timestamp"],
        first_request["body"],
    )
    assert json.loads(first_request["body"])["type"] == "webhook.test"

    retry = api_client.post(
        f"/webhooks/deliveries/{delivery_id}/retry",
        headers=OWNER,
    )
    assert retry.status_code == 202
    assert retry.json()["status"] == "pending"
    assert _run(webhook_service.dispatch_one(transport_factory=transport_factory))

    final_history = api_client.get(
        f"/webhooks/deliveries?endpointId={endpoint['id']}",
        headers=OWNER,
    )
    final = final_history.json()[0]
    assert final["status"] == "delivered"
    assert final["attemptCount"] == 2
    assert [attempt["status"] for attempt in final["attempts"]] == [
        "failed",
        "succeeded",
    ]
    assert final["attempts"][1]["responseStatus"] == 202


def test_incoming_hmac_deduplicates_and_only_fans_out_once(api_client, monkeypatch):
    incoming = _create_endpoint(api_client, monkeypatch, direction="incoming")
    outgoing = _create_endpoint(
        api_client,
        monkeypatch,
        event_types=["webhook.incoming.received"],
    )["endpoint"]

    first = _signed_inbound_request(
        api_client,
        incoming["endpoint"]["id"],
        incoming["signingSecret"],
        "provider-event-17",
    )
    second = _signed_inbound_request(
        api_client,
        incoming["endpoint"]["id"],
        incoming["signingSecret"],
        "provider-event-17",
    )
    assert first.status_code == 202, first.text
    assert first.json()["accepted"] is True
    assert first.json()["duplicate"] is False
    assert second.status_code == 200
    assert second.json()["duplicate"] is True
    assert second.json()["eventId"] == first.json()["eventId"]

    with database.SessionLocal() as session:
        events = list(
            session.scalars(
                select(WebhookEvent).where(
                    WebhookEvent.source_endpoint_id == incoming["endpoint"]["id"]
                )
            )
        )
        deliveries = list(
            session.scalars(
                select(WebhookDelivery).where(
                    WebhookDelivery.endpoint_id == outgoing["id"]
                )
            )
        )
    assert len(events) == 1
    assert events[0].event_type == "webhook.incoming.received"
    assert events[0].payload["data"]["sourceEventType"] == "provider.order.updated"
    assert len(deliveries) == 1


def test_incoming_rejects_bad_signature_expired_timestamp_and_oversized_body(
    api_client, monkeypatch
):
    incoming = _create_endpoint(api_client, monkeypatch, direction="incoming")
    endpoint_id = incoming["endpoint"]["id"]
    secret = incoming["signingSecret"]

    body = b'{"id":"bad-signature","type":"provider.event","data":{}}'
    bad_signature = api_client.post(
        f"/webhooks/incoming/{endpoint_id}",
        content=body,
        headers={
            "content-type": "application/json",
            "x-chatmaster-timestamp": str(int(time.time())),
            "x-chatmaster-signature": "v1=" + "0" * 64,
        },
    )
    assert bad_signature.status_code == 401

    expired_timestamp = str(int(time.time()) - 600)
    expired = _signed_inbound_request(
        api_client,
        endpoint_id,
        secret,
        "expired-event",
        timestamp=expired_timestamp,
    )
    assert expired.status_code == 401

    oversized_body = b" " * (webhook_routes.MAX_INBOUND_BODY_BYTES + 1)
    oversized = _signed_inbound_request(
        api_client,
        endpoint_id,
        secret,
        "oversized-event",
        body=oversized_body,
    )
    assert oversized.status_code == 413


def test_incoming_secret_rotation_invalidates_previous_secret(api_client, monkeypatch):
    incoming = _create_endpoint(api_client, monkeypatch, direction="incoming")
    endpoint_id = incoming["endpoint"]["id"]
    rotated = api_client.post(
        f"/webhooks/endpoints/{endpoint_id}/rotate-secret",
        headers=OWNER,
    )
    assert rotated.status_code == 200
    new_secret = rotated.json()["signingSecret"]
    assert new_secret != incoming["signingSecret"]

    old_secret_request = _signed_inbound_request(
        api_client, endpoint_id, incoming["signingSecret"], "old-secret-event"
    )
    new_secret_request = _signed_inbound_request(
        api_client, endpoint_id, new_secret, "new-secret-event"
    )
    assert old_secret_request.status_code == 401
    assert new_secret_request.status_code == 202


def test_endpoint_crud_and_workspace_scope(api_client, monkeypatch):
    endpoint = _create_endpoint(api_client, monkeypatch)["endpoint"]
    response = api_client.get("/webhooks/endpoints", headers=OWNER)
    assert response.status_code == 200
    assert len(response.json()) == 1

    updated = api_client.patch(
        f"/webhooks/endpoints/{endpoint['id']}",
        headers=OWNER,
        json={"name": "Renamed integration", "isEnabled": False},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Renamed integration"
    assert updated.json()["isEnabled"] is False

    foreign = {
        "x-chatmaster-user-id": "different_workspace",
        "x-chatmaster-user-email": "different@example.test",
        "x-chatmaster-user-name": "Different workspace",
    }
    assert api_client.get("/webhooks/endpoints", headers=foreign).json() == []
    assert (
        api_client.patch(
            f"/webhooks/endpoints/{endpoint['id']}",
            headers=foreign,
            json={"isEnabled": True},
        ).status_code
        == 404
    )
    assert (
        api_client.delete(
            f"/webhooks/endpoints/{endpoint['id']}",
            headers=OWNER,
        ).status_code
        == 204
    )


def test_url_validation_rejects_private_dns_and_embedded_credentials(monkeypatch):
    monkeypatch.setattr(
        webhook_security.socket,
        "getaddrinfo",
        lambda *_args, **_kwargs: [
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("10.4.0.8", 443))
        ],
    )
    with pytest.raises(webhook_security.WebhookSecurityError):
        webhook_security.validate_https_endpoint_url("https://hooks.example.org/receive")
    with pytest.raises(webhook_security.WebhookSecurityError):
        webhook_security.validate_https_endpoint_url(
            "https://user:password@hooks.example.org/receive"
        )
    with pytest.raises(webhook_security.WebhookSecurityError):
        webhook_security.validate_https_endpoint_url(
            "https://hooks.example.org/receive?token=unsafe"
        )


def test_delivery_transport_rejects_dns_rebinding_to_private_address(monkeypatch):
    class FakeLoop:
        async def getaddrinfo(self, *_args, **_kwargs):
            return [
                (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("127.0.0.1", 443))
            ]

    monkeypatch.setattr(webhook_security.asyncio, "get_running_loop", lambda: FakeLoop())

    async def assert_private_target_rejected():
        backend = webhook_security.PublicOnlyAsyncNetworkBackend()
        with pytest.raises(httpcore.ConnectError):
            await backend.connect_tcp("rebound.example.org", 443)

    _run(assert_private_target_rejected())


def test_retry_backoff_is_exponential_and_capped():
    assert [webhook_service._retry_delay(n) for n in range(1, 6)] == [
        5,
        10,
        20,
        40,
        80,
    ]
    assert webhook_service._retry_delay(20) == webhook_service.MAX_RETRY_DELAY_SECONDS
