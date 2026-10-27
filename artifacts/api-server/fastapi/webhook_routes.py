"""Workspace administration and public signed ingress routes for webhooks."""

import json
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from database import get_session
from models import (
    AuditEvent,
    WebhookDelivery,
    WebhookDeliveryAttempt,
    WebhookEndpoint,
    WebhookEvent,
    WebhookSigningSecret,
    WebhookSubscription,
)
from routes import Actor, ActorDep, require_editor
from schemas import (
    IncomingWebhookEnvelope,
    IncomingWebhookResult,
    WebhookDeliveryAttemptOut,
    WebhookDeliveryOut,
    WebhookEndpointCreated,
    WebhookEndpointInput,
    WebhookEndpointOut,
    WebhookEndpointUpdate,
    WebhookEventTypeOut,
    WebhookSecretRotation,
)
from webhook_security import (
    WebhookSecurityError,
    decrypt_signing_secret,
    encrypt_signing_secret,
    generate_signing_secret,
    validate_https_endpoint_url,
    verify_incoming_signature,
)
from webhook_service import (
    SUPPORTED_EVENT_TYPES,
    enqueue_event,
    enqueue_test_delivery,
    utcnow,
)

router = APIRouter()
SessionDep = Annotated[Session, Depends(get_session)]
MAX_INBOUND_BODY_BYTES = 512 * 1024


def _audit_webhook(
    session: Session,
    actor: Actor,
    action: str,
    endpoint_id: uuid.UUID,
    details: dict,
) -> None:
    session.add(
        AuditEvent(
            workspace_id=actor.workspace.id,
            actor_clerk_user_id=actor.user_id,
            action=action,
            entity_type="webhook_endpoint",
            entity_id=str(endpoint_id),
            details=details,
        )
    )


def _workspace_endpoint(
    session: Session, actor: Actor, endpoint_id: uuid.UUID
) -> WebhookEndpoint:
    endpoint = session.scalar(
        select(WebhookEndpoint).where(
            WebhookEndpoint.id == endpoint_id,
            WebhookEndpoint.workspace_id == actor.workspace.id,
        )
    )
    if endpoint is None:
        raise HTTPException(status_code=404, detail="Webhook endpoint not found.")
    return endpoint


def _endpoint_out(session: Session, endpoint: WebhookEndpoint) -> WebhookEndpointOut:
    event_types = list(
        session.scalars(
            select(WebhookSubscription.event_type)
            .where(WebhookSubscription.endpoint_id == endpoint.id)
            .order_by(WebhookSubscription.event_type)
        )
    )
    signing_secret = session.get(WebhookSigningSecret, endpoint.id)
    return WebhookEndpointOut(
        id=endpoint.id,
        name=endpoint.name,
        direction=endpoint.direction,
        url=endpoint.url,
        eventTypes=event_types,
        isEnabled=endpoint.is_enabled,
        secretReference=signing_secret.secret_reference if signing_secret else None,
        createdAt=endpoint.created_at,
        updatedAt=endpoint.updated_at,
    )


def _delivery_out(session: Session, delivery: WebhookDelivery) -> WebhookDeliveryOut:
    event = delivery.event
    attempts = list(
        session.scalars(
            select(WebhookDeliveryAttempt)
            .where(WebhookDeliveryAttempt.delivery_id == delivery.id)
            .order_by(WebhookDeliveryAttempt.attempt_number)
        )
    )
    return WebhookDeliveryOut(
        id=delivery.id,
        endpointId=delivery.endpoint_id,
        eventId=delivery.event_id,
        eventType=event.event_type if event is not None else "webhook.test",
        status=delivery.status,
        attemptCount=delivery.attempt_count,
        retryCount=delivery.retry_count,
        nextAttemptAt=delivery.next_attempt_at,
        httpStatus=delivery.http_status,
        lastError=delivery.last_error,
        createdAt=delivery.created_at,
        updatedAt=delivery.updated_at,
        attempts=[
            WebhookDeliveryAttemptOut(
                id=attempt.id,
                attemptNumber=attempt.attempt_number,
                status=attempt.status,
                requestStartedAt=attempt.request_started_at,
                finishedAt=attempt.finished_at,
                responseStatus=attempt.response_status,
                errorMessage=attempt.error_message,
            )
            for attempt in attempts
        ],
    )


@router.get("/webhooks/events", response_model=list[WebhookEventTypeOut])
def list_webhook_event_types(actor: ActorDep) -> list[WebhookEventTypeOut]:
    return [
        WebhookEventTypeOut(eventType=event_type, description=description)
        for event_type, description in SUPPORTED_EVENT_TYPES.items()
    ]


@router.get("/webhooks/endpoints", response_model=list[WebhookEndpointOut])
def list_webhook_endpoints(
    session: SessionDep, actor: ActorDep
) -> list[WebhookEndpointOut]:
    endpoints = list(
        session.scalars(
            select(WebhookEndpoint)
            .where(WebhookEndpoint.workspace_id == actor.workspace.id)
            .order_by(WebhookEndpoint.updated_at.desc())
            .limit(200)
        )
    )
    return [_endpoint_out(session, endpoint) for endpoint in endpoints]


@router.post(
    "/webhooks/endpoints",
    response_model=WebhookEndpointCreated,
    status_code=status.HTTP_201_CREATED,
)
def create_webhook_endpoint(
    payload: WebhookEndpointInput,
    session: SessionDep,
    actor: ActorDep,
    _editor: Annotated[None, Depends(require_editor)],
) -> WebhookEndpointCreated:
    normalized_url = None
    if payload.direction == "outgoing":
        try:
            normalized_url = validate_https_endpoint_url(payload.url or "")
        except WebhookSecurityError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    endpoint_id = uuid.uuid4()
    secret_reference = uuid.uuid4()
    signing_secret = generate_signing_secret()
    try:
        encrypted_secret, nonce = encrypt_signing_secret(
            endpoint_id, secret_reference, signing_secret
        )
    except WebhookSecurityError as exc:
        raise HTTPException(
            status_code=503,
            detail="Webhook signing secrets are not configured on this server.",
        ) from exc

    endpoint = WebhookEndpoint(
        id=endpoint_id,
        workspace_id=actor.workspace.id,
        name=payload.name,
        direction=payload.direction,
        url=normalized_url,
        is_enabled=True,
        created_by=actor.user_id,
    )
    secret_row = WebhookSigningSecret(
        endpoint_id=endpoint_id,
        secret_reference=secret_reference,
        encrypted_secret=encrypted_secret,
        nonce=nonce,
        key_version=1,
    )
    session.add_all([endpoint, secret_row])
    session.flush()
    for event_type in payload.eventTypes:
        session.add(
            WebhookSubscription(endpoint_id=endpoint_id, event_type=event_type)
        )
    _audit_webhook(
        session,
        actor,
        "webhook.endpoint.created",
        endpoint_id,
        {"name": endpoint.name, "direction": endpoint.direction},
    )
    session.commit()
    session.refresh(endpoint)
    return WebhookEndpointCreated(
        endpoint=_endpoint_out(session, endpoint),
        signingSecret=signing_secret,
        inboundPath=(
            f"/api/webhooks/incoming/{endpoint.id}"
            if endpoint.direction == "incoming"
            else None
        ),
    )


@router.patch(
    "/webhooks/endpoints/{endpoint_id}", response_model=WebhookEndpointOut
)
def update_webhook_endpoint(
    endpoint_id: uuid.UUID,
    payload: WebhookEndpointUpdate,
    session: SessionDep,
    actor: ActorDep,
    _editor: Annotated[None, Depends(require_editor)],
) -> WebhookEndpointOut:
    endpoint = _workspace_endpoint(session, actor, endpoint_id)
    changes = payload.model_dump(exclude_unset=True)
    if endpoint.direction == "incoming" and {"url", "eventTypes"} & changes.keys():
        raise HTTPException(
            status_code=400,
            detail="Incoming endpoints do not have destination URLs or outgoing subscriptions.",
        )
    if "url" in changes:
        if changes["url"] is None:
            raise HTTPException(status_code=400, detail="Outgoing endpoints require an HTTPS URL.")
        try:
            endpoint.url = validate_https_endpoint_url(changes["url"])
        except WebhookSecurityError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if "name" in changes:
        endpoint.name = changes["name"]
    if "isEnabled" in changes:
        endpoint.is_enabled = changes["isEnabled"]
    if "eventTypes" in changes:
        if changes["eventTypes"] is None:
            raise HTTPException(status_code=400, detail="Event subscriptions cannot be null.")
        session.query(WebhookSubscription).filter(
            WebhookSubscription.endpoint_id == endpoint.id
        ).delete(synchronize_session=False)
        for event_type in changes["eventTypes"]:
            session.add(
                WebhookSubscription(
                    endpoint_id=endpoint.id,
                    event_type=event_type,
                )
            )
    endpoint.updated_at = utcnow()
    _audit_webhook(
        session,
        actor,
        "webhook.endpoint.updated",
        endpoint.id,
        {"fields": sorted(changes.keys())},
    )
    session.commit()
    session.refresh(endpoint)
    return _endpoint_out(session, endpoint)


@router.delete(
    "/webhooks/endpoints/{endpoint_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_webhook_endpoint(
    endpoint_id: uuid.UUID,
    session: SessionDep,
    actor: ActorDep,
    _editor: Annotated[None, Depends(require_editor)],
) -> Response:
    endpoint = _workspace_endpoint(session, actor, endpoint_id)
    _audit_webhook(
        session,
        actor,
        "webhook.endpoint.deleted",
        endpoint.id,
        {"name": endpoint.name, "direction": endpoint.direction},
    )
    session.delete(endpoint)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/webhooks/endpoints/{endpoint_id}/rotate-secret",
    response_model=WebhookSecretRotation,
)
def rotate_webhook_secret(
    endpoint_id: uuid.UUID,
    session: SessionDep,
    actor: ActorDep,
    _editor: Annotated[None, Depends(require_editor)],
) -> WebhookSecretRotation:
    endpoint = _workspace_endpoint(session, actor, endpoint_id)
    signing_secret = generate_signing_secret()
    secret_reference = uuid.uuid4()
    try:
        encrypted_secret, nonce = encrypt_signing_secret(
            endpoint.id, secret_reference, signing_secret
        )
    except WebhookSecurityError as exc:
        raise HTTPException(
            status_code=503,
            detail="Webhook signing secrets are not configured on this server.",
        ) from exc

    secret_row = session.get(WebhookSigningSecret, endpoint.id)
    if secret_row is None:
        secret_row = WebhookSigningSecret(endpoint_id=endpoint.id)
        session.add(secret_row)
    secret_row.secret_reference = secret_reference
    secret_row.encrypted_secret = encrypted_secret
    secret_row.nonce = nonce
    secret_row.key_version = 1
    _audit_webhook(
        session,
        actor,
        "webhook.endpoint.secret_rotated",
        endpoint.id,
        {"secretReference": str(secret_reference)},
    )
    session.commit()
    return WebhookSecretRotation(
        signingSecret=signing_secret,
        secretReference=secret_reference,
    )


@router.post(
    "/webhooks/endpoints/{endpoint_id}/test",
    response_model=WebhookDeliveryOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def test_webhook_endpoint(
    endpoint_id: uuid.UUID,
    session: SessionDep,
    actor: ActorDep,
    _editor: Annotated[None, Depends(require_editor)],
) -> WebhookDeliveryOut:
    endpoint = _workspace_endpoint(session, actor, endpoint_id)
    if endpoint.direction != "outgoing":
        raise HTTPException(status_code=400, detail="Only outgoing endpoints can be tested.")
    if not endpoint.is_enabled:
        raise HTTPException(status_code=409, detail="Enable the endpoint before sending a test.")
    delivery = enqueue_test_delivery(session, endpoint)
    _audit_webhook(
        session,
        actor,
        "webhook.endpoint.test_queued",
        endpoint.id,
        {"deliveryId": str(delivery.id)},
    )
    session.commit()
    session.refresh(delivery)
    return _delivery_out(session, delivery)


@router.get("/webhooks/deliveries", response_model=list[WebhookDeliveryOut])
def list_webhook_deliveries(
    endpoint_id: Annotated[uuid.UUID, Query(alias="endpointId")],
    session: SessionDep,
    actor: ActorDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[WebhookDeliveryOut]:
    _workspace_endpoint(session, actor, endpoint_id)
    deliveries = list(
        session.scalars(
            select(WebhookDelivery)
            .options(
                joinedload(WebhookDelivery.event),
                selectinload(WebhookDelivery.attempts),
            )
            .where(
                WebhookDelivery.workspace_id == actor.workspace.id,
                WebhookDelivery.endpoint_id == endpoint_id,
            )
            .order_by(WebhookDelivery.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    )
    return [_delivery_out(session, delivery) for delivery in deliveries]


@router.post(
    "/webhooks/deliveries/{delivery_id}/retry",
    response_model=WebhookDeliveryOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def retry_webhook_delivery(
    delivery_id: uuid.UUID,
    session: SessionDep,
    actor: ActorDep,
    _editor: Annotated[None, Depends(require_editor)],
) -> WebhookDeliveryOut:
    delivery = session.scalar(
        select(WebhookDelivery)
        .options(
            joinedload(WebhookDelivery.endpoint),
            joinedload(WebhookDelivery.event),
            selectinload(WebhookDelivery.attempts),
        )
        .where(
            WebhookDelivery.id == delivery_id,
            WebhookDelivery.workspace_id == actor.workspace.id,
        )
    )
    if delivery is None:
        raise HTTPException(status_code=404, detail="Webhook delivery not found.")
    if delivery.status != "failed":
        raise HTTPException(status_code=409, detail="Only failed deliveries can be retried.")
    if delivery.endpoint is None or not delivery.endpoint.is_enabled:
        raise HTTPException(status_code=409, detail="Enable the endpoint before retrying.")

    delivery.status = "pending"
    delivery.retry_count = 0
    delivery.next_attempt_at = utcnow()
    delivery.claimed_at = None
    delivery.http_status = None
    delivery.last_error = None
    _audit_webhook(
        session,
        actor,
        "webhook.delivery.retry_queued",
        delivery.endpoint_id,
        {"deliveryId": str(delivery.id)},
    )
    session.commit()
    session.refresh(delivery)
    return _delivery_out(session, delivery)


async def _read_bounded_body(request: Request) -> bytes:
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_INBOUND_BODY_BYTES:
                raise HTTPException(status_code=413, detail="Webhook payload is too large.")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid content length.")

    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_INBOUND_BODY_BYTES:
            raise HTTPException(status_code=413, detail="Webhook payload is too large.")
    return bytes(body)


@router.post(
    "/webhooks/incoming/{endpoint_id}",
    response_model=IncomingWebhookResult,
    status_code=status.HTTP_202_ACCEPTED,
)
async def receive_incoming_webhook(
    endpoint_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    timestamp: Annotated[str | None, Header(alias="X-ChatMaster-Timestamp")] = None,
    signature: Annotated[str | None, Header(alias="X-ChatMaster-Signature")] = None,
) -> IncomingWebhookResult | JSONResponse:
    endpoint = session.get(WebhookEndpoint, endpoint_id)
    if (
        endpoint is None
        or endpoint.direction != "incoming"
        or not endpoint.is_enabled
    ):
        raise HTTPException(status_code=404, detail="Incoming webhook endpoint not found.")
    secret_row = session.get(WebhookSigningSecret, endpoint.id)
    if secret_row is None:
        raise HTTPException(status_code=503, detail="Webhook signing is unavailable.")
    try:
        signing_secret = decrypt_signing_secret(
            endpoint.id,
            secret_row.secret_reference,
            secret_row.encrypted_secret,
            secret_row.nonce,
            secret_row.key_version,
        )
    except WebhookSecurityError as exc:
        raise HTTPException(status_code=503, detail="Webhook signing is unavailable.") from exc

    body = await _read_bounded_body(request)
    if not timestamp or not signature or not verify_incoming_signature(
        signing_secret, timestamp, signature, body
    ):
        raise HTTPException(status_code=401, detail="Invalid signature or expired timestamp.")
    try:
        if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
            raise ValueError("JSON content type required")
        envelope = IncomingWebhookEnvelope.model_validate(json.loads(body))
    except (json.JSONDecodeError, UnicodeDecodeError, ValidationError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid webhook event envelope.") from exc

    existing = session.scalar(
        select(WebhookEvent).where(
            WebhookEvent.source_endpoint_id == endpoint.id,
            WebhookEvent.source_event_id == envelope.id,
        )
    )
    if existing is not None:
        return JSONResponse(
            status_code=200,
            content=IncomingWebhookResult(
                accepted=True, duplicate=True, eventId=existing.id
            ).model_dump(mode="json"),
        )

    try:
        event = enqueue_event(
            session,
            endpoint.workspace_id,
            "webhook.incoming.received",
            {
                "sourceEndpointId": str(endpoint.id),
                "sourceEventId": envelope.id,
                "sourceEventType": envelope.type,
                "data": envelope.data,
            },
            source="incoming",
            source_endpoint_id=endpoint.id,
            source_event_id=envelope.id,
        )
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        existing = session.scalar(
            select(WebhookEvent).where(
                WebhookEvent.source_endpoint_id == endpoint.id,
                WebhookEvent.source_event_id == envelope.id,
            )
        )
        if existing is None:
            raise HTTPException(status_code=409, detail="Incoming event could not be processed.") from exc
        return JSONResponse(
            status_code=200,
            content=IncomingWebhookResult(
                accepted=True, duplicate=True, eventId=existing.id
            ).model_dump(mode="json"),
        )

    return IncomingWebhookResult(
        accepted=True,
        duplicate=False,
        eventId=event.id,
    )
