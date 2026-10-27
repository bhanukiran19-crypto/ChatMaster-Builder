"""Webhook secret storage, request signing, and outbound URL safety checks."""

import asyncio
import hashlib
import hmac
import ipaddress
import os
import re
import secrets
import socket
import time
from urllib.parse import urlsplit
from uuid import UUID

import httpcore
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from httpcore._backends.auto import AutoBackend


class WebhookSecurityError(ValueError):
    pass


def generate_signing_secret() -> str:
    return f"cmwhsec_{secrets.token_urlsafe(32)}"


def _encryption_key(key_version: int = 1) -> bytes:
    if key_version != 1:
        raise WebhookSecurityError("Unsupported webhook secret key version.")
    master_secret = (
        os.environ.get("WEBHOOK_ENCRYPTION_KEY", "").strip()
        or os.environ.get("SESSION_SECRET", "").strip()
    )
    if len(master_secret) < 32:
        raise WebhookSecurityError("Webhook secret encryption is not configured.")
    return hashlib.sha256(
        b"chatmaster:webhook-signing-secrets:v1:" + master_secret.encode("utf-8")
    ).digest()


def encrypt_signing_secret(
    endpoint_id: UUID, secret_reference: UUID, secret: str
) -> tuple[bytes, bytes]:
    nonce = secrets.token_bytes(12)
    associated_data = f"chatmaster:webhook:v1:{endpoint_id}:{secret_reference}".encode()
    encrypted = AESGCM(_encryption_key()).encrypt(
        nonce,
        secret.encode("utf-8"),
        associated_data,
    )
    return encrypted, nonce


def decrypt_signing_secret(
    endpoint_id: UUID,
    secret_reference: UUID,
    encrypted_secret: bytes,
    nonce: bytes,
    key_version: int,
) -> str:
    associated_data = (
        f"chatmaster:webhook:v1:{endpoint_id}:{secret_reference}".encode()
    )
    try:
        plaintext = AESGCM(_encryption_key(key_version)).decrypt(
            nonce,
            encrypted_secret,
            associated_data,
        )
    except Exception as exc:
        raise WebhookSecurityError("Webhook signing secret could not be decrypted.") from exc
    return plaintext.decode("utf-8")


def signature_for(secret: str, timestamp: str, body: bytes) -> str:
    digest = hmac.new(
        secret.encode("utf-8"),
        timestamp.encode("ascii") + b"." + body,
        hashlib.sha256,
    ).hexdigest()
    return f"v1={digest}"


def verify_incoming_signature(
    secret: str,
    timestamp: str,
    signature: str,
    body: bytes,
    *,
    now: float | None = None,
    tolerance_seconds: int = 300,
) -> bool:
    if not re.fullmatch(r"[0-9]{10}", timestamp):
        return False
    if not re.fullmatch(r"v1=[a-f0-9]{64}", signature):
        return False
    signed_at = int(timestamp)
    current_time = time.time() if now is None else now
    if abs(current_time - signed_at) > tolerance_seconds:
        return False
    return hmac.compare_digest(signature_for(secret, timestamp, body), signature)


def _public_addresses(host: str, port: int) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        literal = ipaddress.ip_address(host)
        addresses = [literal]
    except ValueError:
        try:
            results = socket.getaddrinfo(
                host,
                port,
                family=socket.AF_UNSPEC,
                type=socket.SOCK_STREAM,
                proto=socket.IPPROTO_TCP,
            )
        except OSError as exc:
            raise WebhookSecurityError(
                "Endpoint hostname did not resolve to a public address."
            ) from exc
        addresses = []
        for result in results:
            try:
                address = ipaddress.ip_address(result[4][0].split("%", 1)[0])
            except ValueError:
                continue
            if address not in addresses:
                addresses.append(address)

    if not addresses or any(not address.is_global for address in addresses):
        raise WebhookSecurityError(
            "Endpoint hostname must resolve only to public IP addresses."
        )
    return addresses


def validate_https_endpoint_url(raw_url: str) -> str:
    value = raw_url.strip()
    if not value or len(value) > 2048 or any(ord(char) < 32 for char in value):
        raise WebhookSecurityError("Enter a valid HTTPS endpoint URL.")
    try:
        parsed = urlsplit(value)
        host = parsed.hostname
        port = parsed.port or 443
    except ValueError as exc:
        raise WebhookSecurityError("Enter a valid HTTPS endpoint URL.") from exc

    if (
        parsed.scheme.lower() != "https"
        or not host
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
        or parsed.query
        or "%" in host
    ):
        raise WebhookSecurityError(
            "Use an HTTPS URL without credentials, query parameters, or fragments."
        )
    if port < 1 or port > 65535:
        raise WebhookSecurityError("Endpoint URL contains an invalid port.")

    normalized_host = host.rstrip(".").lower()
    if (
        normalized_host in {"localhost", "localhost.localdomain"}
        or normalized_host.endswith((".localhost", ".local", ".internal", ".test"))
    ):
        raise WebhookSecurityError("Endpoint hostname must be publicly routable.")
    try:
        ascii_host = normalized_host.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise WebhookSecurityError("Endpoint hostname is invalid.") from exc

    _public_addresses(ascii_host, port)
    return value


class PublicOnlyAsyncNetworkBackend(httpcore.AsyncNetworkBackend):
    """Resolve and pin each HTTPS connection to a public address."""

    def __init__(self) -> None:
        self._backend = AutoBackend()

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: object | None = None,
    ) -> httpcore.AsyncNetworkStream:
        try:
            lookup = await asyncio.get_running_loop().getaddrinfo(
                host,
                port,
                family=socket.AF_UNSPEC,
                type=socket.SOCK_STREAM,
                proto=socket.IPPROTO_TCP,
            )
            addresses: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
            for result in lookup:
                try:
                    address = ipaddress.ip_address(result[4][0].split("%", 1)[0])
                except ValueError:
                    continue
                if address not in addresses:
                    addresses.append(address)
        except (OSError, ValueError) as exc:
            raise httpcore.ConnectError("Webhook endpoint DNS lookup failed.") from exc

        if not addresses or any(not address.is_global for address in addresses):
            raise httpcore.ConnectError(
                "Webhook endpoint resolved to a non-public network address."
            )

        return await self._backend.connect_tcp(
            str(addresses[0]),
            port,
            timeout=timeout,
            local_address=local_address,
            socket_options=socket_options,
        )

    async def connect_unix_socket(
        self,
        path: str,
        timeout: float | None = None,
        socket_options: object | None = None,
    ) -> httpcore.AsyncNetworkStream:
        raise httpcore.ConnectError("Unix sockets are not allowed for webhook delivery.")

    async def sleep(self, seconds: float) -> None:
        await self._backend.sleep(seconds)
