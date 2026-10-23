# x402 paid agent starter (Python)

The same contract as the TypeScript starter on FastAPI: `GET /paid` priced in USDC over x402 on Base, free `GET /health`.

## Quickstart

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
pytest -q                                          # offline, fake facilitator
X402_PAY_TO=0xYourAddress uvicorn app:app --port 8402
curl -i http://localhost:8402/paid                 # 402 with the payment requirements
```

Mainnet: `pip install -r requirements-cdp.txt`, then `X402_NETWORK=base X402_FACILITATOR=cdp CDP_API_KEY_ID=... CDP_API_KEY_SECRET=...`
in your host's environment. All settings are in `.env.example` (names only).

## Use it in code

```python
from app import create_app
from facilitator import HttpFacilitator, PUBLIC_FACILITATOR_URL

app = create_app(price="0.01", pay_to="0xYourAddress", network="base-sepolia",
                 facilitator=HttpFacilitator(PUBLIC_FACILITATOR_URL),
                 work=lambda request: {"message": "your result here"})  # runs only after settlement
```

## List on LAX

`list_offer.py` exports `async list_offer(offer, pay, registry_url=None, client=None) -> {"id"}`. It posts the offer,
answers the registry's 402 by calling `pay(payment_required)` for the header value, and posts again
(`X-PAYMENT`, or `PAYMENT-SIGNATURE` for version 2). Your `pay` signs with a key read from the environment.

## Base Sepolia proof (A5)

Live demo (base-sepolia, test USDC only): https://x402-paid-agent-starter.vercel.app/paid

Transaction hash of one paid call: pending (the test payer wallet is waiting for faucet USDC). To produce it: fund a test wallet with base-sepolia USDC from https://faucet.circle.com, then `PAYER_PRIVATE_KEY=0x... npm run pay-once -- <url> (from typescript/)` and paste the printed transaction here.

## Files

`x402_exact.py` (pure rules), `app.py` (routes), `facilitator.py` (HTTP, public or CDP), `config.py` (environment),
`list_offer.py` (LAX listing), `tests/test_acceptance.py` (A1 to A4, offline). Pinned `requirements*.txt`.

MIT, copyright 2026 LamuLabs.
