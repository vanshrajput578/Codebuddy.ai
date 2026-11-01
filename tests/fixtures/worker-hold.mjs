import pg from "pg";
import { startAgentWorker } from "../../agent/worker-queue.mjs";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
startAgentWorker({
  pool,
  workerId: "hard-kill-worker",
  pollIntervalMs: 10,
  leaseMs: 5_000,
  executeTask: async () => new Promise(() => {})
});
