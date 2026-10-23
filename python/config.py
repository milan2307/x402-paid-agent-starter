"""Reads the environment once. The only module that touches os.environ. Values are never logged."""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping

from facilitator import CDP_FACILITATOR_URL, PUBLIC_FACILITATOR_URL, HttpFacilitator, cdp_auth_headers
from x402_exact import NETWORKS, Facilitator


@dataclass
class Config:
    price: str
    pay_to: str
    network: str
    facilitator: Facilitator
    description: str | None


def load_config(env: Mapping[str, str] = os.environ) -> Config:
    network = env.get("X402_NETWORK") or "base-sepolia"
    if network not in NETWORKS:
        raise ValueError(f"X402_NETWORK must be one of {', '.join(NETWORKS)}")
    pay_to = env.get("X402_PAY_TO")
    if not pay_to:
        raise ValueError("X402_PAY_TO is required (your public receive address)")
    kind = env.get("X402_FACILITATOR") or "public"
    if kind == "cdp":
        key_id, secret = env.get("CDP_API_KEY_ID"), env.get("CDP_API_KEY_SECRET")
        if not key_id or not secret:
            raise ValueError("X402_FACILITATOR=cdp needs CDP_API_KEY_ID and CDP_API_KEY_SECRET")
        url = env.get("X402_FACILITATOR_URL") or CDP_FACILITATOR_URL
        facilitator = HttpFacilitator(url, auth_headers=cdp_auth_headers(key_id, secret, url))
    elif kind == "public":
        if network != "base-sepolia":
            raise ValueError("the public facilitator settles on base-sepolia only; use X402_FACILITATOR=cdp for base")
        facilitator = HttpFacilitator(env.get("X402_FACILITATOR_URL") or PUBLIC_FACILITATOR_URL)
    else:
        raise ValueError("X402_FACILITATOR must be public or cdp")
    return Config(env.get("X402_PRICE") or "0.01", pay_to, network, facilitator, env.get("X402_DESCRIPTION") or None)
