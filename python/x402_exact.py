"""x402 version 1 "exact" scheme on Base: networks, USDC contracts, price math, header codecs and the
local checks run before the facilitator. Pure functions only (no I/O). Mirrors typescript/src/x402.ts."""
from __future__ import annotations

import base64
import binascii
import json
import re
from decimal import Decimal, InvalidOperation
from typing import Any, Protocol

USDC = {
    "base": {"asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "name": "USD Coin", "version": "2"},
    "base-sepolia": {"asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "name": "USDC", "version": "2"},
}
NETWORKS = tuple(USDC)
ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
PRICE_RE = re.compile(r"^\d{1,9}(\.\d{1,6})?$")
HEADER_RE = re.compile(r"^[A-Za-z0-9+/=_-]+$")
MAX_PAYMENT_HEADER_BYTES = 8192
AUTH_FIELDS = ("from", "to", "value", "validAfter", "validBefore", "nonce")


class Facilitator(Protocol):
    async def verify(self, payment_payload: dict, payment_requirements: dict) -> dict: ...  # {isValid, invalidReason?}
    async def settle(self, payment_payload: dict, payment_requirements: dict) -> dict: ...  # {success, transaction, network, errorReason?}


def to_atomic_usdc(price: str) -> str:
    """"0.01" -> "10000" (USDC has 6 decimals). Decimal math, so no float rounding."""
    if not isinstance(price, str) or not PRICE_RE.match(price):
        raise ValueError(f'price must be a decimal USDC string with at most 6 decimals, got "{price}"')
    try:
        atomic = int(Decimal(price) * 1_000_000)
    except InvalidOperation as exc:  # pragma: no cover, PRICE_RE already guards this
        raise ValueError("bad price") from exc
    if atomic == 0:
        raise ValueError("price must be greater than 0")
    return str(atomic)


def build_requirements(*, price: str, pay_to: str, network: str, resource: str, description: str) -> dict:
    usdc = USDC[network]
    return {
        "scheme": "exact",
        "network": network,
        "maxAmountRequired": to_atomic_usdc(price),
        "resource": resource,
        "description": description,
        "mimeType": "application/json",
        "payTo": pay_to,
        "maxTimeoutSeconds": 60,
        "asset": usdc["asset"],
        "extra": {"name": usdc["name"], "version": usdc["version"]},
    }


def encode_header(value: Any) -> str:
    return base64.b64encode(json.dumps(value, separators=(",", ":")).encode()).decode()


def decode_payment_header(header: str) -> dict | None:
    """Decodes an X-PAYMENT header. Returns None for anything that is not well formed."""
    if len(header) > MAX_PAYMENT_HEADER_BYTES or not HEADER_RE.match(header):
        return None
    try:
        p = json.loads(base64.b64decode(header + "=" * (-len(header) % 4), altchars=b"-_" if ("-" in header or "_" in header) else None))
    except (binascii.Error, ValueError, UnicodeDecodeError):
        return None
    if not isinstance(p, dict):
        return None
    payload = p.get("payload") if isinstance(p.get("payload"), dict) else {}
    auth = payload.get("authorization") if isinstance(payload.get("authorization"), dict) else {}
    ok = (
        p.get("x402Version") == 1
        and p.get("scheme") == "exact"
        and isinstance(p.get("network"), str)
        and isinstance(payload.get("signature"), str)
        and all(isinstance(auth.get(k), str) for k in AUTH_FIELDS)
    )
    return p if ok else None


def mismatch_reason(p: dict, r: dict) -> str | None:
    """Cheap local checks before the facilitator: right network, payee and amount."""
    auth = p["payload"]["authorization"]
    if p["network"] != r["network"]:
        return "network_mismatch"
    if not ADDRESS_RE.match(auth["to"]) or auth["to"].lower() != r["payTo"].lower():
        return "payee_mismatch"
    if not re.fullmatch(r"\d{1,30}", auth["value"]) or int(auth["value"]) < int(r["maxAmountRequired"]):
        return "amount_too_low"
    return None
