/**
 * Facilitators over HTTP (x402 version 1 API: POST <url>/verify and <url>/settle).
 *  - public: https://x402.org/facilitator, no key, base-sepolia only.
 *  - cdp: Coinbase CDP, base and base-sepolia, signed with a short-lived JWT from CDP_API_KEY_ID / CDP_API_KEY_SECRET.
 */
import type { Facilitator, PaymentPayload, PaymentRequirements } from "./x402.js";

export const PUBLIC_FACILITATOR_URL = "https://x402.org/facilitator";
export const CDP_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";

type AuthHeaders = (path: string) => Promise<Record<string, string>>;

export function httpFacilitator(o: { url: string; authHeaders?: AuthHeaders; fetch?: typeof fetch; timeoutMs?: number }): Facilitator {
  const doFetch = o.fetch ?? fetch;
  const base = o.url.replace(/\/$/, "");
  async function call(op: "verify" | "settle", paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements) {
    const url = `${base}/${op}`;
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(o.authHeaders ? await o.authHeaders(new URL(url).pathname) : {}) },
      body: JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements }),
      redirect: "error",
      signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
    });
    if (!res.ok) throw new Error(`facilitator ${op} answered ${res.status}`);
    return res.json();
  }
  return {
    verify: (p, r) => call("verify", p, r),
    settle: (p, r) => call("settle", p, r),
  };
}

/** CDP JWT auth. The SDK is loaded only when the CDP facilitator is used. */
export function cdpAuthHeaders(credentials: { apiKeyId: string; apiKeySecret: string }, url = CDP_FACILITATOR_URL): AuthHeaders {
  const host = new URL(url).host;
  return async (path) => {
    const { generateJwt } = await import("@coinbase/cdp-sdk/auth");
    const jwt = await generateJwt({ ...credentials, requestMethod: "POST", requestHost: host, requestPath: path });
    return { authorization: `Bearer ${jwt}` };
  };
}
