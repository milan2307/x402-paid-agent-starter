/**
 * createApp: a web standard fetch handler with one paid route (GET /paid) and a free GET /health.
 * Flow for /paid: no X-PAYMENT -> 402 with requirements. With X-PAYMENT: decode, local checks,
 * facilitator verify, facilitator settle, and only then do the work and answer 200 with X-PAYMENT-RESPONSE.
 */
import {
  ADDRESS_RE,
  NETWORKS,
  buildRequirements,
  decodePaymentHeader,
  encodeHeader,
  mismatchReason,
  toAtomicUsdc,
  type Facilitator,
  type Network,
  type PaymentRequirements,
} from "./x402.js";

export type AppOptions = {
  price: string;
  payTo: string;
  network: Network;
  facilitator: Facilitator;
  description?: string;
  /** The paid work. Runs only after the payment has settled. */
  work?: (request: Request) => Promise<unknown> | unknown;
};

const defaultWork = () => ({ message: "Hello from a paid agent on LAX" });

export function createApp(options: AppOptions): { fetch(request: Request): Promise<Response> } {
  validateOptions(options);
  const description = options.description ?? "One paid call";
  const work = options.work ?? defaultWork;

  async function paid(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const requirements = buildRequirements({ ...options, description, resource: `${url.origin}${url.pathname}` });
    const header = request.headers.get("x-payment");
    if (!header) return paymentRequired(requirements, "X-PAYMENT header is required");

    const payment = decodePaymentHeader(header);
    if (!payment) return paymentRequired(requirements, "invalid_payment_header");
    const mismatch = mismatchReason(payment, requirements);
    if (mismatch) return paymentRequired(requirements, mismatch);

    try {
      const verified = await options.facilitator.verify(payment, requirements);
      if (!verified.isValid) return paymentRequired(requirements, reasonCode(verified.invalidReason, "payment_invalid"));
      const settled = await options.facilitator.settle(payment, requirements);
      if (!settled.success) return paymentRequired(requirements, reasonCode(settled.errorReason, "settlement_failed"));
      const result = await work(request);
      return json(200, result, { "X-PAYMENT-RESPONSE": encodeHeader(settled) });
    } catch {
      // Never echo facilitator errors: they can carry request details.
      return paymentRequired(requirements, "facilitator_unavailable");
    }
  }

  return {
    async fetch(request: Request): Promise<Response> {
      const { pathname } = new URL(request.url);
      if (pathname === "/health") return request.method === "GET" ? json(200, { ok: true }) : methodNotAllowed();
      if (pathname === "/paid") return request.method === "GET" ? paid(request) : methodNotAllowed();
      return json(404, { error: "not_found" });
    },
  };
}

function validateOptions(o: AppOptions): void {
  toAtomicUsdc(o.price); // throws on a bad price
  if (!ADDRESS_RE.test(o.payTo)) throw new Error("payTo must be a 0x address (40 hex characters)");
  if (!NETWORKS.includes(o.network)) throw new Error(`network must be one of ${NETWORKS.join(", ")}`);
  if (typeof o.facilitator?.verify !== "function" || typeof o.facilitator?.settle !== "function") throw new Error("facilitator needs verify and settle");
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

/** Facilitator reasons are passed on only as short codes; free text (RPC dumps, URLs) is replaced. */
const reasonCode = (reason: string | undefined, fallback: string) => (reason && /^[a-z0-9_]{1,64}$/.test(reason) ? reason : fallback);

const paymentRequired = (requirements: PaymentRequirements, error: string) => json(402, { x402Version: 1, error, accepts: [requirements] });

/** HEAD and every other method are refused, so nothing can reach the paid work around the paywall. */
const methodNotAllowed = () => json(405, { error: "method_not_allowed" }, { allow: "GET" });
