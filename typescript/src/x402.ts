/**
 * x402 version 1 "exact" scheme on Base: networks, USDC contracts, price math, header codecs and the
 * local checks we run before asking the facilitator. Pure functions only (no I/O).
 */

export type Network = "base" | "base-sepolia";

/** USDC on each network, with the EIP-712 domain name and version the payer signs against. */
export const USDC: Record<Network, { asset: `0x${string}`; name: string; version: string }> = {
  base: { asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", name: "USD Coin", version: "2" },
  "base-sepolia": { asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", name: "USDC", version: "2" },
};

export const NETWORKS = Object.keys(USDC) as Network[];
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export type PaymentRequirements = {
  scheme: "exact";
  network: Network;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { name: string; version: string };
};

export type PaymentPayload = {
  x402Version: 1;
  scheme: "exact";
  network: Network;
  payload: {
    signature: string;
    authorization: { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string };
  };
};

export type VerifyResult = { isValid: boolean; invalidReason?: string };
export type SettleResult = { success: boolean; transaction: string; network: string; errorReason?: string };

export type Facilitator = {
  verify(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<VerifyResult>;
  settle(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<SettleResult>;
};

/** "0.01" -> "10000" (USDC has 6 decimals). String math, so no float rounding. */
export function toAtomicUsdc(price: string): string {
  const m = /^(\d{1,9})(?:\.(\d{1,6}))?$/.exec(price);
  if (!m) throw new Error(`price must be a decimal USDC string with at most 6 decimals, got "${price}"`);
  const atomic = BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0"));
  if (atomic === 0n) throw new Error("price must be greater than 0");
  return atomic.toString();
}

export function buildRequirements(o: { price: string; payTo: string; network: Network; resource: string; description: string }): PaymentRequirements {
  const usdc = USDC[o.network];
  return {
    scheme: "exact",
    network: o.network,
    maxAmountRequired: toAtomicUsdc(o.price),
    resource: o.resource,
    description: o.description,
    mimeType: "application/json",
    payTo: o.payTo,
    maxTimeoutSeconds: 60,
    asset: usdc.asset,
    extra: { name: usdc.name, version: usdc.version },
  };
}

export const MAX_PAYMENT_HEADER_BYTES = 8192;

export const encodeHeader = (value: unknown): string => Buffer.from(JSON.stringify(value), "utf8").toString("base64");

/** Decodes an X-PAYMENT header. Returns undefined for anything that is not well-formed. */
export function decodePaymentHeader(header: string): PaymentPayload | undefined {
  if (header.length > MAX_PAYMENT_HEADER_BYTES || !/^[A-Za-z0-9+/=_-]+$/.test(header)) return undefined;
  try {
    const p = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    const a = p?.payload?.authorization;
    const ok =
      p?.x402Version === 1 &&
      p.scheme === "exact" &&
      typeof p.network === "string" &&
      typeof p.payload?.signature === "string" &&
      ["from", "to", "value", "validAfter", "validBefore", "nonce"].every((k) => typeof a?.[k] === "string");
    return ok ? (p as PaymentPayload) : undefined;
  } catch {
    return undefined;
  }
}

/** Cheap local checks before the facilitator: right scheme, network, payee and amount. */
export function mismatchReason(p: PaymentPayload, r: PaymentRequirements): string | undefined {
  if (p.network !== r.network) return "network_mismatch";
  if (!ADDRESS_RE.test(p.payload.authorization.to) || p.payload.authorization.to.toLowerCase() !== r.payTo.toLowerCase()) return "payee_mismatch";
  if (!/^\d{1,30}$/.test(p.payload.authorization.value) || BigInt(p.payload.authorization.value) < BigInt(r.maxAmountRequired)) return "amount_too_low";
  return undefined;
}
