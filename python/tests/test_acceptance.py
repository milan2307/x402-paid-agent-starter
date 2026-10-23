"""Kognessium "x402 paid agent starter", Python mirror of A1 to A4 (A6). Offline: fake facilitator, mock transport."""
import asyncio
import base64
import json
import re
from pathlib import Path

import httpx
import jsonschema
import pytest
from fastapi.testclient import TestClient

from app import create_app
from config import load_config
from facilitator import HttpFacilitator
from list_offer import list_offer
from x402_exact import USDC, encode_header, to_atomic_usdc

ROOT = Path(__file__).resolve().parents[1]
PAY_TO = "0x00000000000000000000000000000000000000aa"  # placeholder, receives nothing
TX = "0x" + "12" * 32


class FakeFacilitator:
    def __init__(self):
        self.calls = []
        self.verify_result = {"isValid": True}
        self.settle_result = {"success": True, "transaction": TX, "network": "base-sepolia"}
        self.throw_on = None

    async def verify(self, p, r):
        self.calls.append("verify")
        if self.throw_on == "verify":
            raise RuntimeError("down: secret-ish detail")
        return self.verify_result

    async def settle(self, p, r):
        self.calls.append("settle")
        if self.throw_on == "settle":
            raise RuntimeError("down")
        return self.settle_result


def payment(network="base-sepolia", to=PAY_TO, value="10000", version=1):
    return {
        "x402Version": version,
        "scheme": "exact",
        "network": network,
        "payload": {
            "signature": "0x" + "ab" * 65,
            "authorization": {"from": "0x" + "00" * 19 + "bb", "to": to, "value": value, "validAfter": "0", "validBefore": "9999999999", "nonce": "0x" + "01" * 32},
        },
    }


def make(f=None, price="0.01", network="base-sepolia"):
    f = f or FakeFacilitator()
    worked = []

    def work(_req):
        worked.append(1)
        return {"message": "done"}

    return TestClient(create_app(price=price, pay_to=PAY_TO, network=network, facilitator=f, work=work)), f, worked


def paid(client, p):
    return client.get("/paid", headers={"X-PAYMENT": p if isinstance(p, str) else encode_header(p)})


@pytest.mark.parametrize("network,price,atomic", [("base", "0.01", "10000"), ("base-sepolia", "1.5", "1500000")])
def test_A1_unpaid_call_answers_402_with_requirements(network, price, atomic):
    client, f, worked = make(price=price, network=network)
    res = client.get("/paid?x=1")
    assert res.status_code == 402
    body = res.json()
    assert body["x402Version"] == 1 and isinstance(body["error"], str)
    assert body["accepts"] == [{
        "scheme": "exact", "network": network, "maxAmountRequired": atomic, "resource": "http://testserver/paid",
        "description": "One paid call", "mimeType": "application/json", "payTo": PAY_TO, "maxTimeoutSeconds": 60,
        "asset": USDC[network]["asset"], "extra": {"name": USDC[network]["name"], "version": "2"},
    }]
    assert USDC["base"]["asset"] == "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    assert USDC["base-sepolia"]["asset"] == "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    assert worked == [] and f.calls == []


def test_A1_health_free_and_other_methods_refused():
    client, f, worked = make()
    assert client.get("/health").status_code == 200
    for method in ["HEAD", "POST", "PUT", "OPTIONS"]:
        assert client.request(method, "/paid").status_code == 405
    assert client.get("/other").status_code == 404
    assert worked == [] and f.calls == []


def test_A1_bad_configuration_refused():
    f = FakeFacilitator()
    for price in ["0", "-1", "1e3", "0.0000001", "abc", ""]:
        with pytest.raises(ValueError):
            create_app(price=price, pay_to=PAY_TO, network="base", facilitator=f)
    with pytest.raises(ValueError):
        create_app(price="0.01", pay_to="0x123", network="base", facilitator=f)
    with pytest.raises(ValueError):
        create_app(price="0.01", pay_to=PAY_TO, network="mainnet", facilitator=f)
    assert to_atomic_usdc("0.000001") == "1"
    with pytest.raises(ValueError, match="cdp"):
        load_config({"X402_PAY_TO": PAY_TO, "X402_NETWORK": "base"})
    with pytest.raises(ValueError, match="CDP_API_KEY_ID"):
        load_config({"X402_PAY_TO": PAY_TO, "X402_FACILITATOR": "cdp"})
    assert load_config({"X402_PAY_TO": PAY_TO}).network == "base-sepolia"


def test_A2_paid_call_verified_settled_then_answered():
    client, f, worked = make()
    res = paid(client, payment())
    assert res.status_code == 200
    assert res.json() == {"message": "done"}
    assert json.loads(base64.b64decode(res.headers["x-payment-response"])) == {"success": True, "transaction": TX, "network": "base-sepolia"}
    assert f.calls == ["verify", "settle"] and worked == [1]


@pytest.mark.parametrize("setup,calls,error", [
    (lambda f: setattr(f, "verify_result", {"isValid": False, "invalidReason": "invalid_signature"}), ["verify"], "invalid_signature"),
    (lambda f: setattr(f, "settle_result", {"success": False, "transaction": "", "network": "base-sepolia", "errorReason": "insufficient_funds"}), ["verify", "settle"], "insufficient_funds"),
    (lambda f: setattr(f, "throw_on", "verify"), ["verify"], "facilitator_unavailable"),
    (lambda f: setattr(f, "throw_on", "settle"), ["verify", "settle"], "facilitator_unavailable"),
    (lambda f: setattr(f, "settle_result", {"success": False, "transaction": "", "network": "base-sepolia", "errorReason": "HTTP request failed.\nURL: https://rpc.example/ secret"}), ["verify", "settle"], "settlement_failed"),
])
def test_A2_failed_verify_or_settle_gets_402_and_no_work(setup, calls, error):
    f = FakeFacilitator()
    setup(f)
    client, _, worked = make(f)
    res = paid(client, payment())
    assert res.status_code == 402
    assert res.json()["error"] == error and "secret" not in res.text
    assert f.calls == calls and worked == []


@pytest.mark.parametrize("p", [
    "not base64 !!", "A" * 9000, payment(version=2), payment(network="base"),
    payment(to="0x" + "00" * 19 + "cc"), payment(value="9999"), payment(value="1e9"),
])
def test_A2_bad_payment_refused_before_facilitator(p):
    client, f, worked = make()
    assert paid(client, p).status_code == 402
    assert f.calls == [] and worked == []


def test_A2_http_facilitator_posts_version_1_bodies():
    seen = []

    def handler(request: httpx.Request):
        seen.append((str(request.url), json.loads(request.content)))
        if request.url.path.endswith("verify"):
            return httpx.Response(200, json={"isValid": True})
        return httpx.Response(200, json={"success": True, "transaction": TX, "network": "base-sepolia"})

    fac = HttpFacilitator("https://facilitator.test/", client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    client = TestClient(create_app(price="0.01", pay_to=PAY_TO, network="base-sepolia", facilitator=fac))
    assert paid(client, payment()).status_code == 200
    assert [s[0] for s in seen] == ["https://facilitator.test/verify", "https://facilitator.test/settle"]
    assert seen[0][1]["x402Version"] == 1 and seen[0][1]["paymentRequirements"]["maxAmountRequired"] == "10000"


def test_A3_offer_passes_lax_validation_with_five_laws():
    offer = json.loads((ROOT / "lax-offer.json").read_text())
    schema = json.loads((ROOT / "tests/fixtures/lax-offer.section.json").read_text())["schema"]
    jsonschema.validate(offer, schema)
    assert offer["constitutional_constraints"] == ["Solidarity Oath", "Renewal Mandate", "Treasury Equilibrium", "Harm Shield", "Transparency Covenant"]
    assert offer["capabilities"][0]["pricing"] == {"model": "per_call", "amount": "0.01", "currency": "USDC", "rail": "x402"}
    assert offer["endpoint"].startswith("https://") and "kognai.ai" not in offer["endpoint"]
    assert len(json.dumps(offer, separators=(",", ":")).encode()) < 16 * 1024


@pytest.mark.parametrize("version", [1, 2])
def test_A4_listing_pays_the_402_and_returns_the_id(version, capsys):
    key = "0x" + "9f" * 32
    terms = {"x402Version": version, "accepts": [{"scheme": "exact", "amount": "10000"}]}
    posts = []

    def handler(request: httpx.Request):
        posts.append(dict(request.headers))
        if "x-payment" not in request.headers and "payment-signature" not in request.headers:
            if version == 2:
                return httpx.Response(402, json={}, headers={"payment-required": base64.b64encode(json.dumps(terms).encode()).decode()})
            return httpx.Response(402, json=terms)
        return httpx.Response(201, json={"ok": True, "id": "lax-ext-123"})

    paid_with = []

    async def pay(t):
        paid_with.append(t)
        return "signed-with-" + key[:4]

    result = asyncio.run(list_offer({"name": "x"}, pay, client=httpx.AsyncClient(transport=httpx.MockTransport(handler))))
    assert result == {"id": "lax-ext-123"}
    assert paid_with == [terms] and len(posts) == 2
    assert posts[1]["payment-signature" if version == 2 else "x-payment"] == "signed-with-0x9f"
    out = capsys.readouterr()
    assert key not in out.out + out.err


def test_A4_refused_listing_raises_without_echoing_the_payment():
    key = "0x" + "9f" * 32

    async def pay(_t):
        return key

    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(400, json={"error": "offer refused"})))
    with pytest.raises(RuntimeError, match="400: offer refused") as err:
        asyncio.run(list_offer({"name": "x"}, pay, client=client))
    assert key not in str(err.value)


def test_A5_readme_records_a_base_sepolia_paid_call():
    proof = re.search(r"Transaction hash of one paid call: (0x[0-9a-f]{64})", (ROOT / "README.md").read_text())
    if not proof:
        pytest.skip("A5 pending: run the starter on base-sepolia and pay once (typescript: npm run pay-once)")
    assert re.fullmatch(r"0x[0-9a-f]{64}", proof.group(1))
