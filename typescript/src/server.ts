/** Node entry: npm start. On Bun, Deno or a worker, export createApp(...).fetch instead. */
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = createApp(config);
serve({ fetch: app.fetch, port: config.port });
console.log(`x402 starter on http://localhost:${config.port} (network ${config.network}, price ${config.price} USDC)`);
