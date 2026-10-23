"""Facilitators over HTTP (x402 version 1 API: POST <url>/verify and <url>/settle).
 - public: https://x402.org/facilitator, no key, base-sepolia only.
 - cdp: Coinbase CDP, base and base-sepolia, signed with a short-lived JWT (pip install -r requirements-cdp.txt)."""
from __future__ import annotations

from typing import Awaitable, Callable
from urllib.parse import urlparse

import httpx

PUBLIC_FACILITATOR_URL = "https://x402.org/facilitator"
CDP_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402"

AuthHeaders = Callable[[str], Awaitable[dict]]


class HttpFacilitator:
    def __init__(self, url: str, auth_headers: AuthHeaders | None = None, client: httpx.AsyncClient | None = None, timeout: float = 15.0):
        self.base = url.rstrip("/")
        self.auth_headers = auth_headers
        self.client = client
        self.timeout = timeout

    async def _call(self, op: str, payment_payload: dict, payment_requirements: dict) -> dict:
        url = f"{self.base}/{op}"
        headers = {"content-type": "application/json"}
        if self.auth_headers:
            headers.update(await self.auth_headers(urlparse(url).path))
        body = {"x402Version": 1, "paymentPayload": payment_payload, "paymentRequirements": payment_requirements}
        client = self.client or httpx.AsyncClient(timeout=self.timeout, follow_redirects=False)
        try:
            res = await client.post(url, json=body, headers=headers)
        finally:
            if self.client is None:
                await client.aclose()
        if res.status_code >= 400:
            raise RuntimeError(f"facilitator {op} answered {res.status_code}")
        return res.json()

    async def verify(self, payment_payload: dict, payment_requirements: dict) -> dict:
        return await self._call("verify", payment_payload, payment_requirements)

    async def settle(self, payment_payload: dict, payment_requirements: dict) -> dict:
        return await self._call("settle", payment_payload, payment_requirements)


def cdp_auth_headers(api_key_id: str, api_key_secret: str, url: str = CDP_FACILITATOR_URL) -> AuthHeaders:
    host = urlparse(url).netloc

    async def headers(path: str) -> dict:
        from cdp.auth.utils.jwt import JwtOptions, generate_jwt  # loaded only for the CDP facilitator

        jwt = generate_jwt(JwtOptions(api_key_id=api_key_id, api_key_secret=api_key_secret, request_method="POST", request_host=host, request_path=path))
        return {"authorization": f"Bearer {jwt}"}

    return headers
