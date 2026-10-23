"""create_app: a FastAPI app with one paid route (GET /paid) and a free GET /health. Mirrors typescript/src/app.ts.
Flow for /paid: no X-PAYMENT -> 402 with requirements. With X-PAYMENT: decode, local checks, facilitator
verify, facilitator settle, and only then do the work and answer 200 with X-PAYMENT-RESPONSE.
Run: uvicorn app:app (reads the environment through config.py)."""
from __future__ import annotations

import inspect
from typing import Any, Callable

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from x402_exact import ADDRESS_RE, NETWORKS, Facilitator, build_requirements, decode_payment_header, encode_header, mismatch_reason, to_atomic_usdc

Work = Callable[[Request], Any]


def default_work(_request: Request) -> dict:
    return {"message": "Hello from a paid agent on LAX"}


def create_app(*, price: str, pay_to: str, network: str, facilitator: Facilitator, description: str | None = None, work: Work | None = None) -> FastAPI:
    to_atomic_usdc(price)  # raises on a bad price
    if not isinstance(pay_to, str) or not ADDRESS_RE.match(pay_to):
        raise ValueError("pay_to must be a 0x address (40 hex characters)")
    if network not in NETWORKS:
        raise ValueError(f"network must be one of {', '.join(NETWORKS)}")
    if not callable(getattr(facilitator, "verify", None)) or not callable(getattr(facilitator, "settle", None)):
        raise ValueError("facilitator needs verify and settle")
    description = description or "One paid call"
    work = work or default_work

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/health")
    async def health() -> JSONResponse:
        return _json(200, {"ok": True})

    @app.get("/paid")
    async def paid(request: Request) -> JSONResponse:
        requirements = build_requirements(price=price, pay_to=pay_to, network=network, resource=f"{request.url.scheme}://{request.url.netloc}{request.url.path}", description=description)
        header = request.headers.get("x-payment")
        if not header:
            return _payment_required(requirements, "X-PAYMENT header is required")
        payment = decode_payment_header(header)
        if payment is None:
            return _payment_required(requirements, "invalid_payment_header")
        mismatch = mismatch_reason(payment, requirements)
        if mismatch:
            return _payment_required(requirements, mismatch)
        try:
            verified = await facilitator.verify(payment, requirements)
            if not verified.get("isValid"):
                return _payment_required(requirements, verified.get("invalidReason") or "payment_invalid")
            settled = await facilitator.settle(payment, requirements)
            if not settled.get("success"):
                return _payment_required(requirements, settled.get("errorReason") or "settlement_failed")
        except Exception:  # never echo facilitator errors: they can carry request details
            return _payment_required(requirements, "facilitator_unavailable")
        result = work(request)
        if inspect.isawaitable(result):
            result = await result
        return _json(200, result, {"X-PAYMENT-RESPONSE": encode_header(settled)})

    # HEAD and every other method are refused, so nothing reaches the paid work around the paywall.
    @app.api_route("/paid", methods=["HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], include_in_schema=False)
    @app.api_route("/health", methods=["HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], include_in_schema=False)
    async def method_not_allowed() -> JSONResponse:
        return _json(405, {"error": "method_not_allowed"}, {"allow": "GET"})

    return app


def _json(status: int, body: Any, headers: dict | None = None) -> JSONResponse:
    return JSONResponse(body, status_code=status, headers={"cache-control": "no-store", **(headers or {})})


def _payment_required(requirements: dict, error: str) -> JSONResponse:
    return _json(402, {"x402Version": 1, "error": error, "accepts": [requirements]})


def _app_from_env() -> FastAPI:
    from config import load_config

    c = load_config()
    return create_app(price=c.price, pay_to=c.pay_to, network=c.network, facilitator=c.facilitator, description=c.description)


def __getattr__(name: str) -> Any:  # `uvicorn app:app` builds the app lazily, so importing create_app needs no env
    if name == "app":
        return _app_from_env()
    raise AttributeError(name)
