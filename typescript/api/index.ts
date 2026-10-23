/** Vercel entry: every path is rewritten here (vercel.json); the web standard handler does the routing. */
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const app = createApp(loadConfig());
export default { fetch: app.fetch };
