/** Reads the environment once. The only file that touches process.env. Values are never logged. */
import { CDP_FACILITATOR_URL, PUBLIC_FACILITATOR_URL, cdpAuthHeaders, httpFacilitator } from "./facilitator.js";
import { NETWORKS, type Facilitator, type Network } from "./x402.js";

export type Config = { price: string; payTo: string; network: Network; facilitator: Facilitator; description?: string; port: number };

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const network = (env.X402_NETWORK ?? "base-sepolia") as Network;
  if (!NETWORKS.includes(network)) throw new Error(`X402_NETWORK must be one of ${NETWORKS.join(", ")}`);
  const payTo = env.X402_PAY_TO;
  if (!payTo) throw new Error("X402_PAY_TO is required (your public receive address)");

  const kind = env.X402_FACILITATOR ?? "public";
  let facilitator: Facilitator;
  if (kind === "cdp") {
    if (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET) throw new Error("X402_FACILITATOR=cdp needs CDP_API_KEY_ID and CDP_API_KEY_SECRET");
    const url = env.X402_FACILITATOR_URL ?? CDP_FACILITATOR_URL;
    facilitator = httpFacilitator({ url, authHeaders: cdpAuthHeaders({ apiKeyId: env.CDP_API_KEY_ID, apiKeySecret: env.CDP_API_KEY_SECRET }, url) });
  } else if (kind === "public") {
    if (network !== "base-sepolia") throw new Error("the public facilitator settles on base-sepolia only; use X402_FACILITATOR=cdp for base");
    facilitator = httpFacilitator({ url: env.X402_FACILITATOR_URL ?? PUBLIC_FACILITATOR_URL });
  } else {
    throw new Error("X402_FACILITATOR must be public or cdp");
  }

  return { price: env.X402_PRICE ?? "0.01", payTo, network, facilitator, description: env.X402_DESCRIPTION, port: Number(env.PORT ?? 8402) };
}
