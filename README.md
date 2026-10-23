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

## Proof on Base Sepolia (A5)

| Starter | Paid call transaction |
|---|---|
| TypeScript (live demo https://x402-paid-agent-starter.vercel.app/paid) | [0xb8b6df73bc5fea0829f88780700410df9a1f20cf5cb4ea375381c46e00c895e3](https://sepolia.basescan.org/tx/0xb8b6df73bc5fea0829f88780700410df9a1f20cf5cb4ea375381c46e00c895e3) |
| Python (local) | [0xe5f8bd4daa092edf57c72f875935ce95f94fbf53f44892c8f38f0a1830f206f5](https://sepolia.basescan.org/tx/0xe5f8bd4daa092edf57c72f875935ce95f94fbf53f44892c8f38f0a1830f206f5) |
