/** Offline test wiring: a recording fake facilitator and payment payload builders. No network. */
import type { Facilitator, PaymentPayload, PaymentRequirements, SettleResult, VerifyResult } from "../src/x402.js";
import { encodeHeader } from "../src/x402.js";

export const PAY_TO = "0x00000000000000000000000000000000000000aa"; // placeholder, receives nothing
export const PAYER = "0x00000000000000000000000000000000000000bb";
export const TX = "0x" + "12".repeat(32);

export class FakeFacilitator implements Facilitator {
  calls: string[] = [];
  verifyResult: VerifyResult = { isValid: true };
  settleResult: SettleResult = { success: true, transaction: TX, network: "base-sepolia" };
  throwOn?: "verify" | "settle";
  async verify(_p: PaymentPayload, _r: PaymentRequirements) {
    this.calls.push("verify");
    if (this.throwOn === "verify") throw new Error("down: secret-ish detail");
    return this.verifyResult;
  }
  async settle(_p: PaymentPayload, _r: PaymentRequirements) {
    this.calls.push("settle");
    if (this.throwOn === "settle") throw new Error("down");
    return this.settleResult;
  }
}

export function payment(over: { network?: string; to?: string; value?: string } = {}): PaymentPayload {
  return {
    x402Version: 1,
    scheme: "exact",
    network: (over.network ?? "base-sepolia") as PaymentPayload["network"],
    payload: {
      signature: "0x" + "ab".repeat(65),
      authorization: { from: PAYER, to: over.to ?? PAY_TO, value: over.value ?? "10000", validAfter: "0", validBefore: "9999999999", nonce: "0x" + "01".repeat(32) },
    },
  };
}

export const paidGet = (p: unknown, url = "http://localhost/paid") =>
  new Request(url, { headers: { "x-payment": typeof p === "string" ? p : encodeHeader(p) } });

export const decode = (h: string | null) => JSON.parse(Buffer.from(h ?? "", "base64").toString("utf8"));
