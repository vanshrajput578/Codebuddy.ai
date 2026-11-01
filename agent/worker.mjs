import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { pool, runAgentTask } from "../server.mjs";
import { startAgentWorker } from "./worker-queue.mjs";

if (!pool) throw new Error("DATABASE_URL must be configured before starting the agent worker.");

const worker = startAgentWorker({
  pool,
  workerId: `nexus-worker-${randomUUID()}`,
  executeTask: (taskId, userId, leaseToken, leaseLost) => runAgentTask(taskId, userId, leaseToken, leaseLost),
  onError: error => console.error("[nexus-worker]", error?.message || error)
});

const healthHost = process.env.WORKER_HEALTH_HOST || "127.0.0.1";
const healthPort = Number(process.env.WORKER_HEALTH_PORT || 4001);
const healthServer = createServer((req, res) => {
  if (req.url !== "/health" || req.method !== "GET") {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "Not found" }));
  }
  const health = worker.health();
  res.writeHead(health.ok ? 200 : 503, {
    "content-type": "application/json",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(health));
});
healthServer.listen(healthPort, healthHost, () => {
  console.log(`NEXUS agent worker started: ${worker.workerId}; health: http://${healthHost}:${healthPort}/health`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[nexus-worker] ${signal} received; draining active task`);
  await new Promise(resolve => healthServer.close(resolve));
  await worker.stop();
  await pool.end();
  process.exit(0);
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
