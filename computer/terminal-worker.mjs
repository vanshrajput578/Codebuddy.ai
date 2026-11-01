import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createTerminalWorkerServer } from "./terminal-service.mjs";

const host = process.env.TERMINAL_WORKER_HOST || "127.0.0.1";
const port = Number(process.env.TERMINAL_WORKER_PORT || 4003);
const server = createTerminalWorkerServer({
  token: process.env.TERMINAL_WORKER_TOKEN,
  host,
  port
});
server.listen(port, host, () => {
  console.log(`[nexus-terminal-worker] ready on ${host}:${port}; instance=${randomUUID()}`);
});

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[nexus-terminal-worker] ${signal} received; closing listener`);
  await new Promise(resolve => server.close(resolve));
  process.exit(0);
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
