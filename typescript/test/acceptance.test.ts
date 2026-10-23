/** Kognessium "x402 paid agent starter": one describe per acceptance item, A1 to A6. Offline. */
import { existsSync, readFileSync } from "node:fs";
import { Ajv } from "ajv";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { httpFacilitator } from "../src/facilitator.js";
import { listOffer } from "../src/list.js";
import { USDC, toAtomicUsdc } from "../src/x402.js";
import { FakeFacilitator, PAY_TO, TX, decode, paidGet, payment } from "./helpers.js";

const make = (f = new FakeFacilitator(), price = "0.01", network: "base" | "base-sepolia" = "base-sepolia") => {
  const work = vi.fn(() => ({ message: "done" }));
  return { app: createApp({ price, payTo: PAY_TO, network, facilitator: f, work }), f, work };
};

describe("A1 an unpaid call answers 402 with valid x402 requirements", () => {
  it.each([
    ["base", "0.01", "10000"],
    ["base-sepolia", "1.5", "1500000"],
  ] as const)("A1 %s at %s USDC", async (network, price, atomic) => {
    const { app, work } = make(new FakeFacilitator(), price, network);
    const res = await app.fetch(new Request("http://localhost/paid?x=1"));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.x402Version).toBe(1);
    expect(typeof body.error).toBe("string");
    expect(body.accepts).toEqual([
      {
        scheme: "exact",
        network,
        maxAmountRequired: atomic,
        resource: "http://localhost/paid",
        description: "One paid call",
        mimeType: "application/json",
        payTo: PAY_TO,
        maxTimeoutSeconds: 60,
        asset: USDC[network].asset,
        extra: { name: USDC[network].name, version: "2" },
      },
    ]);
    expect(USDC.base.asset).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(USDC["base-sepolia"].asset).toBe("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
    expect(work).not.toHaveBeenCalled();
  });

  it("A1 GET /health is free; HEAD and POST on /paid are refused, so the work cannot run unpaid", async () => {
    const { app, f, work } = make();
    expect((await app.fetch(new Request("http://localhost/health"))).status).toBe(200);
    for (const method of ["HEAD", "POST", "PUT", "OPTIONS"]) expect((await app.fetch(new Request("http://localhost/paid", { method }))).status).toBe(405);
    expect((await app.fetch(new Request("http://localhost/other"))).status).toBe(404);
    expect(f.calls).toEqual([]);
    expect(work).not.toHaveBeenCalled();
  });

  it("A1 bad configuration is refused at startup", () => {
    const facilitator = new FakeFacilitator();
    for (const price of ["0", "-1", "1e3", "0.0000001", "abc", ""]) expect(() => createApp({ price, payTo: PAY_TO, network: "base", facilitator })).toThrow();
    expect(() => createApp({ price: "0.01", payTo: "0x123", network: "base", facilitator })).toThrow();
    expect(() => createApp({ price: "0.01", payTo: PAY_TO, network: "mainnet" as any, facilitator })).toThrow();
    expect(toAtomicUsdc("0.000001")).toBe("1");
    expect(() => loadConfig({ X402_PAY_TO: PAY_TO, X402_NETWORK: "base" })).toThrow(/cdp/);
    expect(() => loadConfig({ X402_PAY_TO: PAY_TO, X402_FACILITATOR: "cdp" })).toThrow(/CDP_API_KEY_ID/);
    expect(loadConfig({ X402_PAY_TO: PAY_TO }).network).toBe("base-sepolia");
  });
});

describe("A2 a paid call is verified, settled, then answered; failures get 402 and no work", () => {
  it("A2 success: verify then settle then work, 200 with X-PAYMENT-RESPONSE", async () => {
    const f = new FakeFacilitator();
    const { app, work } = make(f);
    const res = await app.fetch(paidGet(payment()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "done" });
    expect(decode(res.headers.get("x-payment-response"))).toEqual({ success: true, transaction: TX, network: "base-sepolia" });
    expect(f.calls).toEqual(["verify", "settle"]);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["verify says invalid", (f: FakeFacilitator): void => { f.verifyResult = { isValid: false, invalidReason: "invalid_signature" }; }, ["verify"], "invalid_signature"],
    ["settle fails", (f: FakeFacilitator): void => { f.settleResult = { success: false, transaction: "", network: "base-sepolia", errorReason: "insufficient_funds" }; }, ["verify", "settle"], "insufficient_funds"],
    ["verify throws", (f: FakeFacilitator): void => { f.throwOn = "verify"; }, ["verify"], "facilitator_unavailable"],
    ["settle throws", (f: FakeFacilitator): void => { f.throwOn = "settle"; }, ["verify", "settle"], "facilitator_unavailable"],
    ["settle fails with a free text dump", (f: FakeFacilitator): void => { f.settleResult = { success: false, transaction: "", network: "base-sepolia", errorReason: "HTTP request failed.\nURL: https://rpc.example/ secret" }; }, ["verify", "settle"], "settlement_failed"],
  ] as const)("A2 %s -> 402, no work", async (_name, setup, calls, error) => {
    const f = new FakeFacilitator();
    setup(f);
    const { app, work } = make(f);
    const res = await app.fetch(paidGet(payment()));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe(error);
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(f.calls).toEqual(calls);
    expect(work).not.toHaveBeenCalled();
  });

  it.each([
    ["garbage header", "not base64 !!"],
    ["oversized header", "A".repeat(9000)],
    ["wrong version", { ...payment(), x402Version: 2 }],
    ["wrong network", payment({ network: "base" })],
    ["wrong payee", payment({ to: "0x00000000000000000000000000000000000000cc" })],
    ["amount too low", payment({ value: "9999" })],
    ["non numeric amount", payment({ value: "1e9" })],
  ])("A2 %s -> 402 before the facilitator, no work", async (_name, p) => {
    const { app, f, work } = make();
    const res = await app.fetch(paidGet(p));
    expect(res.status).toBe(402);
    expect(f.calls).toEqual([]);
    expect(work).not.toHaveBeenCalled();
  });

  it("A2 the HTTP facilitator posts version 1 bodies to /verify and /settle", async () => {
    const seen: any[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen.push([url, JSON.parse(String(init.body))]);
      return new Response(JSON.stringify(url.endsWith("verify") ? { isValid: true } : { success: true, transaction: TX, network: "base-sepolia" }));
    }) as unknown as typeof fetch;
    const app = createApp({ price: "0.01", payTo: PAY_TO, network: "base-sepolia", facilitator: httpFacilitator({ url: "https://facilitator.test/", fetch: fakeFetch }) });
    expect((await app.fetch(paidGet(payment()))).status).toBe(200);
    expect(seen.map((s) => s[0])).toEqual(["https://facilitator.test/verify", "https://facilitator.test/settle"]);
    expect(seen[0][1]).toMatchObject({ x402Version: 1, paymentPayload: payment(), paymentRequirements: { maxAmountRequired: "10000" } });
  });
});

describe("A3 the offer passes the LAX registry validation, with the Five Laws", () => {
  const offer = JSON.parse(readFileSync("lax-offer.json", "utf8"));
  const schema = JSON.parse(readFileSync("test/fixtures/lax-offer.section.json", "utf8")).schema;
  it("A3 lax-offer.json validates against lax_offer and declares the Five Laws", () => {
    const ajv = new Ajv({ strict: false, allErrors: true });
    expect(ajv.validate(schema, offer), JSON.stringify(ajv.errors)).toBe(true);
    expect(offer.constitutional_constraints).toEqual(["Solidarity Oath", "Renewal Mandate", "Treasury Equilibrium", "Harm Shield", "Transparency Covenant"]);
    expect(offer.capabilities[0].pricing).toEqual({ model: "per_call", amount: "0.01", currency: "USDC", rail: "x402" });
    expect(new URL(offer.endpoint).protocol).toBe("https:");
    expect(new URL(offer.endpoint).hostname.endsWith("kognai.ai")).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(offer))).toBeLessThan(16 * 1024);
  });
});

describe("A4 the listing script answers the registry's 402, pays and returns the id, without logging a key", () => {
  const offer = { name: "x" };
  const KEY = "0x" + "9f".repeat(32);

  function registry(version: 1 | 2) {
    const posts: Record<string, string>[] = [];
    const terms = { x402Version: version, accepts: [{ scheme: "exact", amount: "10000" }] };
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      posts.push(headers);
      if (!headers["X-PAYMENT"] && !headers["PAYMENT-SIGNATURE"]) {
        return version === 2
          ? new Response("{}", { status: 402, headers: { "payment-required": Buffer.from(JSON.stringify(terms)).toString("base64") } })
          : new Response(JSON.stringify(terms), { status: 402 });
      }
      return new Response(JSON.stringify({ ok: true, id: "lax-ext-123" }), { status: 201 });
    }) as unknown as typeof fetch;
    return { fakeFetch, posts, terms };
  }

  it.each([1, 2] as const)("A4 version %s: 402, pay(terms), repost with the payment header, id returned", async (version) => {
    const { fakeFetch, posts, terms } = registry(version);
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const errs = vi.spyOn(console, "error").mockImplementation(() => {});
    const pay = vi.fn(async (_t: unknown) => `signed-with-${KEY.slice(0, 4)}`);
    const result = await listOffer({ offer, fetch: fakeFetch, pay });
    expect(result).toEqual({ id: "lax-ext-123" });
    expect(pay).toHaveBeenCalledWith(terms);
    expect(posts).toHaveLength(2);
    expect(posts[1]![version === 2 ? "PAYMENT-SIGNATURE" : "X-PAYMENT"]).toBe("signed-with-0x9f");
    const printed = JSON.stringify([...logs.mock.calls, ...errs.mock.calls]);
    expect(printed).not.toContain(KEY);
    logs.mockRestore();
    errs.mockRestore();
  });

  it("A4 a refused listing throws without echoing the payment header", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ error: "offer refused" }), { status: 400 })) as unknown as typeof fetch;
    await expect(listOffer({ offer, fetch: fakeFetch, pay: async () => KEY })).rejects.toThrow(/400: offer refused/);
    await expect(listOffer({ offer, fetch: fakeFetch, pay: async () => KEY })).rejects.not.toThrow(new RegExp(KEY));
  });
});

describe("A5 402 then a paid call on Base Sepolia, transaction hash in the README", () => {
  const proof = /Transaction hash of one paid call: (0x[0-9a-f]{64})/.exec(readFileSync("README.md", "utf8"));
  it.skipIf(!proof)("A5 README records the Base Sepolia transaction of one paid call (run npm run pay-once)", () => {
    expect(proof![1]).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("A6 the Python starter mirrors A1 to A4 with pytest tests", () => {
  const py = "../python/tests/test_acceptance.py";
  it.skipIf(!existsSync(py))("A6 python tests named A1 to A4 exist", () => {
    const src = readFileSync(py, "utf8");
    for (const a of ["A1", "A2", "A3", "A4"]) expect(src).toMatch(new RegExp(`def test_${a}_`));
  });
});
