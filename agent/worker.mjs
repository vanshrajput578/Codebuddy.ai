import "dotenv/config";
import { randomUUID } from "node:crypto";
import { pool, runAgentTask } from "../server.mjs";
import { startAgentWorker } from "./worker-queue.mjs";

if (!pool) throw new Error("DATABASE_URL must be configured before starting the agent worker.");

const worker = startAgentWorker({
  pool,
  workerId: `nexus-worker-${randomUUID()}`,
  executeTask: (taskId, userId, leaseToken) => runAgentTask(taskId, userId, leaseToken),
  onError: error => console.error("[nexus-worker]", error?.message || error)
});

console.log(`NEXUS agent worker started: ${worker.workerId}`);

async function shutdown() {
  await worker.stop();
  await pool.end();
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
