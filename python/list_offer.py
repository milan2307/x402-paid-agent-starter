"""list_offer: lists an offer on the LAX registry. POST /offers; the registry answers 402 with the listing
fee terms; pay(payment_required) returns the payment header value; POST again with it. The caller owns
the key (read from its environment). This module never sees or logs it. Mirrors typescript/src/list.ts.

As a script: python list_offer.py prints how to list; signing needs an x402 client of your choice."""
from __future__ import annotations

import base64
import json
from typing import Any, Awaitable, Callable

import httpx

LAX_REGISTRY_URL = "https://lax.kognai.ai/registry"
Pay = Callable[[Any], Awaitable[str]]


async def list_offer(offer: Any, pay: Pay, registry_url: str | None = None, client: httpx.AsyncClient | None = None) -> dict:
    url = f"{(registry_url or LAX_REGISTRY_URL).rstrip('/')}/offers"
    own = client is None
    client = client or httpx.AsyncClient(timeout=30, follow_redirects=False)
    try:
        res = await client.post(url, json=offer)
        if res.status_code == 402:
            payment_required = _read_payment_required(res)
            header = await pay(payment_required)
            name = "PAYMENT-SIGNATURE" if isinstance(payment_required, dict) and payment_required.get("x402Version") == 2 else "X-PAYMENT"
            res = await client.post(url, json=offer, headers={name: header})
    finally:
        if own:
            await client.aclose()
    try:
        body = res.json()
    except ValueError:
        body = {}
    if res.status_code >= 400 or not isinstance(body, dict) or not isinstance(body.get("id"), str):
        detail = f": {body['error']}" if isinstance(body, dict) and isinstance(body.get("error"), str) else ""
        raise RuntimeError(f"listing failed with HTTP {res.status_code}{detail}")
    return {"id": body["id"]}


def _read_payment_required(res: httpx.Response) -> Any:
    """Version 2 puts the terms in a PAYMENT-REQUIRED header (base64 JSON); version 1 in the body."""
    header = res.headers.get("payment-required")
    if header:
        return json.loads(base64.b64decode(header))
    return res.json()


if __name__ == "__main__":
    print("Import list_offer and pass pay=, an async function that signs the registry's x402 terms with your key")
    print("(read it from the environment, never from a file in the repo). The TypeScript starter has a ready CLI: npm run list.")
