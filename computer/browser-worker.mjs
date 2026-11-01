import "dotenv/config";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { createBrowserWorkerServer } from "./browser-service.mjs";

const token = process.env.BROWSER_WORKER_TOKEN;
const egressProxy = process.env.BROWSER_EGRESS_PROXY;
const host = process.env.BROWSER_WORKER_HOST || "127.0.0.1";
const port = Number(process.env.BROWSER_WORKER_PORT || 4002);

const server = createBrowserWorkerServer({ chromium, token, egressProxy, host, port });
server.listen(port, host, () => {
  console.log(`[nexus-browser-worker] ready on ${host}:${port}; instance=${randomUUID()}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[nexus-browser-worker] ${signal} received; closing worker`);
  await new Promise(resolve => server.close(resolve));
  process.exit(0);
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
