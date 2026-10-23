/**
 * npm run list: lists lax-offer.json on LAX and prints the listing id. Costs the listing fee (0.01 USDC on Base).
 * The paying wallet owns the listing. Its key is read from LAX_PAYER_PRIVATE_KEY and never printed.
 */
import { readFileSync } from "node:fs";
import { x402Client } from "@x402/core/client";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { listOffer } from "../src/list.js";

const key = process.env.LAX_PAYER_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("set LAX_PAYER_PRIVATE_KEY (0x + 64 hex) in the environment");

const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(key as `0x${string}`) });

const offer = JSON.parse(readFileSync("lax-offer.json", "utf8"));
const { id } = await listOffer({
  offer,
  registryUrl: process.env.LAX_REGISTRY_URL,
  pay: async (paymentRequired) => {
    const payload = await client.createPaymentPayload(paymentRequired);
    return encodePaymentSignatureHeader(payload);
  },
});
console.log(`listed: ${id}`);
