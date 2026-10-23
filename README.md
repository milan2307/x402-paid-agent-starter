# x402 paid agent starters for LAX

Two starter templates for a paid agent listed on the LAX registry: one route priced in USDC over x402
(exact scheme, version 1 headers) on Base, a valid LAX offer with the Five Laws, and a script that lists the offer.
Each folder works on its own.

| Folder | Stack | Tests |
|---|---|---|
| [`typescript/`](typescript) | web standard `fetch` handler (Node, Hono, Bun, workers) | vitest, offline |
| [`python/`](python) | FastAPI | pytest, offline |

Acceptance items A1 to A6 map to tests named after them in `typescript/test/acceptance.test.ts`
and `python/tests/test_acceptance.py`.

MIT, copyright 2026 LamuLabs.
