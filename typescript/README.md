# x402 paid agent starter (TypeScript)

One paid route, `GET /paid`, priced in USDC over x402 on Base, plus a free `GET /health`. Web standard, so
`createApp(...).fetch` runs on Node, Hono, Bun or a worker.

## Quickstart

```bash
npm install
npm test                                   # offline, fake facilitator
X402_PAY_TO=0xYourAddress npm start        # base-sepolia through the public x402.org facilitator
curl -i http://localhost:8402/paid         # 402 with the payment requirements
```

Mainnet: `X402_NETWORK=base X402_FACILITATOR=cdp CDP_API_KEY_ID=... CDP_API_KEY_SECRET=...` (set in your host, not in files).
All settings are in `.env.example` (names only).

## Use it in code

```ts
import { createApp } from "./src/app.js";
import { httpFacilitator, PUBLIC_FACILITATOR_URL } from "./src/facilitator.js";

const app = createApp({
  price: "0.01",                          // USDC, decimal string
  payTo: process.env.X402_PAY_TO!,        // your receive address
  network: "base-sepolia",                // or "base"
  facilitator: httpFacilitator({ url: PUBLIC_FACILITATOR_URL }),
  description: "One paid call",
  work: async (request) => ({ message: "your result here" }), // optional; runs only after settlement
});
export default { fetch: app.fetch };
```

## How a call works

1. `GET /paid` without `X-PAYMENT`: 402 with `{x402Version: 1, error, accepts: [requirements]}`
   (exact scheme, `maxAmountRequired` in atomic USDC, USDC contract of the network, `payTo`, `resource`).
2. With `X-PAYMENT` (base64 JSON payload): local checks (version, network, payee, amount), then the facilitator
   verifies, then settles. Only then the work runs and the answer is 200 with `X-PAYMENT-RESPONSE`.
3. A payment that does not verify or settle, or a facilitator that is down, gets 402 and the work does not run.
4. `HEAD`, `POST` and other methods on `/paid` get 405, so nothing reaches the work around the paywall.

## List on LAX

Edit `lax-offer.json` (name, your https endpoint, price, schemas), then:

```bash
LAX_PAYER_PRIVATE_KEY=0x... npm run list    # pays the 0.01 USDC listing fee on Base, prints the listing id
```

`src/list.ts` exports `listOffer({offer, registryUrl?, fetch?, pay})`. The key is read by the caller from the
environment and is never logged. The paying wallet owns the listing.

## Base Sepolia proof (A5)

Transaction hash of one paid call: pending (added after a live run with a funded test wallet).

## Code map

- `src/x402.ts`: networks, USDC contracts, price math, header codecs, local payment checks (pure).
- `src/app.ts`: `createApp`, the routes and the verify, settle, work order.
- `src/facilitator.ts`: HTTP facilitator (public or CDP with JWT auth).
- `src/config.ts`: the only file that reads the environment.
- `src/list.ts` and `scripts/list-offer.ts`: listing on LAX.

MIT, copyright 2026 LamuLabs.
