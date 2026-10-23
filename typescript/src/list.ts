/**
 * listOffer: lists an offer on the LAX registry. POST /offers; the registry answers 402 with the
 * listing fee terms; pay(paymentRequired) returns the payment header value; POST again with it.
 * The caller owns the key (read from its environment). This file never sees or logs it.
 */
export const LAX_REGISTRY_URL = "https://lax.kognai.ai/registry";

export type ListOptions = {
  offer: unknown;
  registryUrl?: string;
  fetch?: typeof fetch;
  pay: (paymentRequired: any) => Promise<string>;
};

export async function listOffer(o: ListOptions): Promise<{ id: string }> {
  const doFetch = o.fetch ?? fetch;
  const url = `${(o.registryUrl ?? LAX_REGISTRY_URL).replace(/\/$/, "")}/offers`;
  const post = (headers: Record<string, string> = {}) =>
    doFetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(o.offer) });

  let res = await post();
  if (res.status === 402) {
    const paymentRequired = await readPaymentRequired(res);
    const header = await o.pay(paymentRequired);
    const name = paymentRequired?.x402Version === 2 ? "PAYMENT-SIGNATURE" : "X-PAYMENT";
    res = await post({ [name]: header });
  }
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || typeof body?.id !== "string") {
    throw new Error(`listing failed with HTTP ${res.status}${typeof body?.error === "string" ? `: ${body.error}` : ""}`);
  }
  return { id: body.id };
}

/** Version 2 puts the terms in a PAYMENT-REQUIRED header (base64 JSON); version 1 in the body. */
async function readPaymentRequired(res: Response): Promise<any> {
  const header = res.headers.get("payment-required");
  if (header) return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  return res.json();
}
