"""Transactional webhook event queue and bounded, signed delivery worker."""

import asyncio
import json
import logging
import ssl
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable

import httpcore
import httpx
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import joinedload, selectinload

import database
from models import (
    WebhookDelivery,
    WebhookDeliveryAttempt,
    WebhookEndpoint,
    WebhookEvent,
    WebhookSigningSecret,
    WebhookSubscription,
)
from webhook_security import (
    PublicOnlyAsyncNetworkBackend,
    WebhookSecurityError,
    decrypt_signing_secret,
    signature_for,
)

logger = logging.getLogger("chatmaster.webhooks")

SUPPORTED_EVENT_TYPES: dict[str, str] = {
    "flow.published": "A flow version was published and its immutable snapshot was saved.",
    "webhook.incoming.received": "A valid signed incoming event was accepted and processed.",
}

MAX_AUTOMATIC_RETRIES = 5
BASE_RETRY_DELAY_SECONDS = 5
MAX_RETRY_DELAY_SECONDS = 3600
DELIVERY_LEASE_SECONDS = 60
DELIVERY_TIMEOUT_SECONDS = 10
MAX_DELIVERY_BODY_BYTES = 1024 * 1024


@dataclass(frozen=True)
class ClaimedDelivery:
    delivery_id: uuid.UUID
    attempt_id: uuid.UUID
    endpoint_id: uuid.UUID
    url: str
    event_type: str
    payload: dict
    signing_secret: str
    attempt_number: int


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _retry_delay(retry_number: int) -> int:
    return min(
        BASE_RETRY_DELAY_SECONDS * (2 ** max(retry_number - 1, 0)),
        MAX_RETRY_DELAY_SECONDS,
    )


def _build_payload(
    event_id: uuid.UUID, event_type: str, data: dict, created_at: datetime
) -> dict:
    payload = {
        "id": str(event_id),
        "type": event_type,
        "createdAt": created_at.isoformat(),
        "data": data,
    }
    if len(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")) > MAX_DELIVERY_BODY_BYTES:
        raise ValueError("Webhook event payload exceeds the delivery size limit.")
    return payload


def enqueue_event(
    session,
    workspace_id: uuid.UUID,
    event_type: str,
    data: dict,
    *,
    source: str = "app",
    source_endpoint_id: uuid.UUID | None = None,
    source_event_id: str | None = None,
) -> WebhookEvent:
    """Persist one event and all currently subscribed deliveries atomically."""
    if event_type not in SUPPORTED_EVENT_TYPES:
        raise ValueError("This webhook event type is not currently supported.")

    event_id = uuid.uuid4()
    created_at = utcnow()
    event = WebhookEvent(
        id=event_id,
        workspace_id=workspace_id,
        source=source,
        source_endpoint_id=source_endpoint_id,
        source_event_id=source_event_id,
        event_type=event_type,
        payload=_build_payload(event_id, event_type, data, created_at),
        created_at=created_at,
    )
    session.add(event)
    session.flush()

    endpoint_ids = session.scalars(
        select(WebhookSubscription.endpoint_id)
        .join(WebhookEndpoint, WebhookEndpoint.id == WebhookSubscription.endpoint_id)
        .where(
            WebhookEndpoint.workspace_id == workspace_id,
            WebhookEndpoint.direction == "outgoing",
            WebhookEndpoint.is_enabled.is_(True),
            WebhookSubscription.event_type == event_type,
        )
    )
    for endpoint_id in endpoint_ids:
        session.add(
            WebhookDelivery(
                workspace_id=workspace_id,
                endpoint_id=endpoint_id,
                event_id=event_id,
                status="pending",
                attempt_count=0,
                retry_count=0,
                next_attempt_at=created_at,
            )
        )
    return event


def enqueue_test_delivery(
    session, endpoint: WebhookEndpoint
) -> WebhookDelivery:
    event_id = uuid.uuid4()
    created_at = utcnow()
    event = WebhookEvent(
        id=event_id,
        workspace_id=endpoint.workspace_id,
        source="test",
        event_type="webhook.test",
        payload=_build_payload(
            event_id,
            "webhook.test",
            {
                "message": "This is a signed ChatMaster test delivery.",
                "endpointId": str(endpoint.id),
            },
            created_at,
        ),
        created_at=created_at,
    )
    delivery = WebhookDelivery(
        workspace_id=endpoint.workspace_id,
        endpoint_id=endpoint.id,
        event_id=event_id,
        status="pending",
        attempt_count=0,
        retry_count=0,
        next_attempt_at=created_at,
    )
    session.add_all([event, delivery])
    session.flush()
    return delivery


def public_webhook_transport() -> httpx.AsyncHTTPTransport:
    """Build a transport that pins sockets to validated public DNS answers."""
    transport = httpx.AsyncHTTPTransport(
        verify=True,
        trust_env=False,
        http1=True,
        http2=False,
        limits=httpx.Limits(
            max_connections=1,
            max_keepalive_connections=0,
            keepalive_expiry=0,
        ),
    )
    transport._pool = httpcore.AsyncConnectionPool(
        ssl_context=ssl.create_default_context(),
        max_connections=1,
        max_keepalive_connections=0,
        keepalive_expiry=0,
        http1=True,
        http2=False,
        retries=0,
        network_backend=PublicOnlyAsyncNetworkBackend(),
    )
    return transport


async def _send_claimed_delivery(
    delivery: ClaimedDelivery,
    transport_factory: Callable[[], httpx.AsyncBaseTransport],
) -> tuple[int | None, str | None]:
    body = json.dumps(
        delivery.payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    if len(body) > MAX_DELIVERY_BODY_BYTES:
        return None, "Webhook payload exceeded the delivery size limit."

    timestamp = str(int(time.time()))
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "ChatMaster-Webhooks/1.0",
        "X-ChatMaster-Event": delivery.event_type,
        "X-ChatMaster-Delivery": str(delivery.delivery_id),
        "X-ChatMaster-Timestamp": timestamp,
        "X-ChatMaster-Signature": signature_for(
            delivery.signing_secret, timestamp, body
        ),
    }
    timeout = httpx.Timeout(
        connect=3.0,
        read=DELIVERY_TIMEOUT_SECONDS,
        write=DELIVERY_TIMEOUT_SECONDS,
        pool=2.0,
    )
    try:
        async with httpx.AsyncClient(
            transport=transport_factory(),
            timeout=timeout,
            follow_redirects=False,
            trust_env=False,
        ) as client:
            async with client.stream(
                "POST",
                delivery.url,
                content=body,
                headers=headers,
            ) as response:
                status_code = response.status_code
                return status_code, None
    except httpx.TimeoutException:
        return None, "The endpoint did not respond before the delivery timeout."
    except (httpx.RequestError, httpcore.NetworkError):
        return None, "Unable to connect securely to the endpoint."


def _mark_attempt_failed(
    session,
    delivery: WebhookDelivery,
    attempt: WebhookDeliveryAttempt,
    now: datetime,
    message: str,
) -> None:
    attempt.status = "failed"
    attempt.finished_at = now
    attempt.error_message = message
    delivery.last_error = message
    delivery.claimed_at = None
    delivery.http_status = None
    if delivery.retry_count < MAX_AUTOMATIC_RETRIES:
        delivery.retry_count += 1
        delivery.status = "pending"
        delivery.next_attempt_at = now + timedelta(
            seconds=_retry_delay(delivery.retry_count)
        )
    else:
        delivery.status = "failed"
        delivery.next_attempt_at = None


def _claim_due_delivery(session_factory) -> tuple[ClaimedDelivery | None, bool]:
    """Claim one queue row. The boolean reports whether a row was handled."""
    session = session_factory()
    now = utcnow()
    stale_before = now - timedelta(seconds=DELIVERY_LEASE_SECONDS)
    try:
        delivery = session.scalar(
            select(WebhookDelivery)
            .options(
                joinedload(WebhookDelivery.endpoint).joinedload(
                    WebhookEndpoint.signing_secret
                ),
                joinedload(WebhookDelivery.event),
            )
            .where(
                or_(
                    and_(
                        WebhookDelivery.status == "pending",
                        WebhookDelivery.next_attempt_at <= now,
                    ),
                    and_(
                        WebhookDelivery.status == "delivering",
                        WebhookDelivery.claimed_at <= stale_before,
                    ),
                )
            )
            .order_by(WebhookDelivery.next_attempt_at, WebhookDelivery.created_at)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        if delivery is None:
            return None, False

        if delivery.status == "delivering":
            previous_attempt = session.scalar(
                select(WebhookDeliveryAttempt)
                .where(
                    WebhookDeliveryAttempt.delivery_id == delivery.id,
                    WebhookDeliveryAttempt.status == "in_progress",
                )
                .order_by(WebhookDeliveryAttempt.attempt_number.desc())
                .limit(1)
            )
            if previous_attempt:
                _mark_attempt_failed(
                    session,
                    delivery,
                    previous_attempt,
                    now,
                    "A previous worker stopped before receiving a response.",
                )
            else:
                delivery.status = "failed"
                delivery.last_error = "A previous worker stopped before receiving a response."
                delivery.claimed_at = None
                delivery.next_attempt_at = None
            session.commit()
            return None, True

        endpoint = delivery.endpoint
        if (
            endpoint is None
            or endpoint.direction != "outgoing"
            or not endpoint.is_enabled
            or not endpoint.url
        ):
            delivery.status = "cancelled"
            delivery.last_error = "Endpoint was disabled before delivery."
            delivery.claimed_at = None
            delivery.next_attempt_at = None
            session.commit()
            return None, True

        secret_row = endpoint.signing_secret
        if secret_row is None:
            delivery.status = "failed"
            delivery.last_error = "Webhook signing secret is unavailable."
            delivery.claimed_at = None
            delivery.next_attempt_at = None
            session.commit()
            return None, True

        attempt_number = delivery.attempt_count + 1
        try:
            signing_secret = decrypt_signing_secret(
                endpoint.id,
                secret_row.secret_reference,
                secret_row.encrypted_secret,
                secret_row.nonce,
                secret_row.key_version,
            )
        except WebhookSecurityError:
            attempt = WebhookDeliveryAttempt(
                delivery_id=delivery.id,
                attempt_number=attempt_number,
                status="failed",
                request_started_at=now,
                finished_at=now,
                error_message="Webhook signing secret is unavailable.",
            )
            session.add(attempt)
            delivery.attempt_count = attempt_number
            delivery.status = "failed"
            delivery.last_error = "Webhook signing secret is unavailable."
            delivery.claimed_at = None
            delivery.next_attempt_at = None
            session.commit()
            return None, True

        attempt = WebhookDeliveryAttempt(
            delivery_id=delivery.id,
            attempt_number=attempt_number,
            status="in_progress",
            request_started_at=now,
        )
        session.add(attempt)
        delivery.attempt_count = attempt_number
        delivery.status = "delivering"
        delivery.claimed_at = now
        session.commit()
        return (
            ClaimedDelivery(
                delivery_id=delivery.id,
                attempt_id=attempt.id,
                endpoint_id=endpoint.id,
                url=endpoint.url,
                event_type=delivery.event.event_type,
                payload=delivery.event.payload,
                signing_secret=signing_secret,
                attempt_number=attempt_number,
            ),
            True,
        )
    finally:
        session.close()


def _finish_delivery(
    session_factory,
    claim: ClaimedDelivery,
    response_status: int | None,
    send_error: str | None,
) -> None:
    session = session_factory()
    now = utcnow()
    try:
        delivery = session.scalar(
            select(WebhookDelivery)
            .where(WebhookDelivery.id == claim.delivery_id)
            .with_for_update()
        )
        attempt = session.get(WebhookDeliveryAttempt, claim.attempt_id)
        if delivery is None or attempt is None or delivery.status != "delivering":
            return

        attempt.finished_at = now
        attempt.response_status = response_status
        delivery.http_status = response_status
        delivery.claimed_at = None

        if send_error is None and response_status is not None and 200 <= response_status < 300:
            attempt.status = "succeeded"
            attempt.error_message = None
            delivery.status = "delivered"
            delivery.last_error = None
            delivery.next_attempt_at = None
        else:
            message = send_error or f"The endpoint returned HTTP {response_status}."
            attempt.status = "failed"
            attempt.error_message = message
            delivery.last_error = message[:500]
            if delivery.retry_count < MAX_AUTOMATIC_RETRIES:
                delivery.retry_count += 1
                delivery.status = "pending"
                delivery.next_attempt_at = now + timedelta(
                    seconds=_retry_delay(delivery.retry_count)
                )
            else:
                delivery.status = "failed"
                delivery.next_attempt_at = None
        session.commit()
    finally:
        session.close()


async def dispatch_one(
    session_factory=None,
    transport_factory: Callable[[], httpx.AsyncBaseTransport] = public_webhook_transport,
) -> bool:
    """Claim and perform a single durable webhook delivery."""
    session_factory = session_factory or database.SessionLocal
    claim, handled = await asyncio.to_thread(_claim_due_delivery, session_factory)
    if claim is None:
        return handled

    response_status, send_error = await _send_claimed_delivery(
        claim, transport_factory
    )
    await asyncio.to_thread(
        _finish_delivery,
        session_factory,
        claim,
        response_status,
        send_error,
    )
    return True


async def webhook_delivery_worker() -> None:
    """Poll the persistent queue; row locks allow multiple API replicas."""
    while True:
        try:
            handled = await dispatch_one()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error(
                "Webhook delivery worker iteration failed",
                extra={"error_type": type(exc).__name__},
            )
            handled = False
        if not handled:
            await asyncio.sleep(1)
