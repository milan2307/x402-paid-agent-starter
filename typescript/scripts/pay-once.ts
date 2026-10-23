/**
 * npm run pay-once -- <url>: makes ONE paid call to an x402 version 1 endpoint (for the A5 proof on base-sepolia).
 * GET -> 402 -> sign an EIP-3009 USDC transferWithAuthorization -> GET with X-PAYMENT -> print the transaction.
 * The payer key is read from PAYER_PRIVATE_KEY and never printed. Refuses anything but base-sepolia.
 */
import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { encodeHeader, USDC, type PaymentRequirements } from "../src/x402.js";

const url = process.argv[2];
const key = process.env.PAYER_PRIVATE_KEY;
if (!url || !key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("usage: PAYER_PRIVATE_KEY=0x... npm run pay-once -- <url>");
const account = privateKeyToAccount(key as `0x${string}`);

const unpaid = await fetch(url);
if (unpaid.status !== 402) throw new Error(`expected 402, got ${unpaid.status}`);
const req: PaymentRequirements = (await unpaid.json()).accepts[0];
if (req.network !== "base-sepolia" || req.asset !== USDC["base-sepolia"].asset) throw new Error("pay-once only pays test USDC on base-sepolia");

const now = Math.floor(Date.now() / 1000);
const authorization = {
  from: account.address,
  to: req.payTo as `0x${string}`,
  value: req.maxAmountRequired,
  validAfter: String(now - 60),
  validBefore: String(now + req.maxTimeoutSeconds),
  nonce: `0x${randomBytes(32).toString("hex")}` as `0x${string}`,
};
const signature = await account.signTypedData({
  domain: { name: req.extra.name, version: req.extra.version, chainId: 84532, verifyingContract: req.asset as `0x${string}` },
  types: {
    TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    ],
  },
  primaryType: "TransferWithAuthorization",
  message: { ...authorization, value: BigInt(authorization.value), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) },
});

const paid = await fetch(url, { headers: { "x-payment": encodeHeader({ x402Version: 1, scheme: "exact", network: "base-sepolia", payload: { signature, authorization } }) } });
const receipt = paid.headers.get("x-payment-response");
console.log(`unpaid: 402, paid: ${paid.status}`);
console.log(await paid.text());
if (receipt) console.log(`transaction: ${JSON.parse(Buffer.from(receipt, "base64").toString("utf8")).transaction}`);
