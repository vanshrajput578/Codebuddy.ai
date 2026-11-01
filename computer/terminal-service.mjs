import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { validateWorkspacePath } from "./terminal-sandbox-runner.mjs";

const MAX_BODY_BYTES = 1_500_000;
const MAX_COMMAND_CHARS = 4_000;
const MAX_FILES = 30;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_FILE_BYTES = 1_000_000;
const MAX_WALL_TIME_MS = 18_000;
const MAX_WORKER_OUTPUT_BYTES = 1_500_000;
const WINDOW_MS = 60_000;
const PER_USER_LIMIT = 10;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}
function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}
async function readJson(request) {
  const declared = Number(request.headers["content-length"] || 0);
  if (declared > MAX_BODY_BYTES) throw new Error("Terminal job payload exceeds 1.5 MiB.");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Terminal job payload exceeds 1.5 MiB.");
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("Terminal job payload must be valid JSON."); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      Object.keys(payload).some(key => !["userId", "command", "files", "timeoutMs"].includes(key))) {
    throw new Error("Terminal job contains unsupported fields.");
  }
  if (typeof payload.userId !== "string" || !UUID_PATTERN.test(payload.userId)) throw new Error("A valid user ID is required.");
  if (typeof payload.command !== "string" || !payload.command.trim() || payload.command.length > MAX_COMMAND_CHARS) {
    throw new Error("Command must contain 1–4000 characters.");
  }
  const timeoutMs = payload.timeoutMs === undefined ? 10_000 : payload.timeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 15_000) throw new Error("Timeout must be between 1 and 15 seconds.");
  if (!Array.isArray(payload.files || []) || (payload.files || []).length > MAX_FILES) throw new Error("At most 30 workspace files are allowed.");
  const seen = new Set();
  let total = 0;
  for (const file of payload.files || []) {
    if (!file || typeof file !== "object" || Array.isArray(file) ||
        Object.keys(file).some(key => !["path", "contentBase64"].includes(key)) ||
        typeof file.path !== "string" || typeof file.contentBase64 !== "string") {
      throw new Error("Workspace file entries must contain path and contentBase64.");
    }
    if (!file.path || file.path.length > 240 || file.path.startsWith("/") || file.path.includes("\\") ||
        file.path.includes("\0") || file.path.split("/").some(segment => !segment || segment === "." || segment === ".." ||
          segment.length > 80 || /[<>:"|?*\x00-\x1f]/.test(segment) || segment.endsWith(".") || segment.endsWith(" "))) {
      throw new Error("Workspace file path is unsafe.");
    }
    if (file.path.split("/").length > 12) throw new Error("Workspace file path has too many segments.");
    if (seen.has(file.path)) throw new Error("Duplicate workspace file path.");
    seen.add(file.path);
    if (file.contentBase64.length > Math.ceil(MAX_FILE_BYTES * 4 / 3) + 8) throw new Error("A workspace file is too large.");
    const bytes = Buffer.from(file.contentBase64, "base64");
    if (bytes.length > MAX_FILE_BYTES || bytes.toString("base64") !== file.contentBase64) throw new Error("Workspace file content must be valid base64 and at most 256 KiB.");
    total += bytes.length;
    if (total > MAX_TOTAL_FILE_BYTES) throw new Error("Total workspace input is limited to 1 MiB.");
  }
  return { userId: payload.userId, command: payload.command, files: payload.files || [], timeoutMs };
}

export function runTerminalSandbox(job, options = {}) {
  const dockerBin = options.dockerBin || process.env.SANDBOX_DOCKER_BIN || "docker";
  const image = options.image || process.env.TERMINAL_SANDBOX_IMAGE || "nexus-terminal-sandbox:latest";
  const containerName = "nexus-terminal-" + randomUUID();
  const args = [
    "run", "--rm", "--init", "--name", containerName,
    "--network", "none",
    "--read-only",
    "--user", "10001:10001",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--pids-limit=64",
    "--memory=256m",
    "--memory-swap=256m",
    "--cpus=0.5",
    "--ulimit", "fsize=1048576:1048576",
    "--ulimit", "nofile=64:64",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m,uid=10001,gid=10001",
    "--tmpfs", "/workspace:rw,nosuid,nodev,size=64m,uid=10001,gid=10001",
    image
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(dockerBin, args, {
      env: {
        PATH: process.env.PATH || "/usr/bin:/bin",
        ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}),
        ...(process.env.DOCKER_CONTEXT ? { DOCKER_CONTEXT: process.env.DOCKER_CONTEXT } : {})
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let outputOverflow = false;
    let timedOut = false;
    const outerTimeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, MAX_WALL_TIME_MS);
    child.stdout.on("data", chunk => {
      if (stdout.length + chunk.length > MAX_WORKER_OUTPUT_BYTES) {
        outputOverflow = true;
        child.kill("SIGKILL");
        return;
      }
      stdout = Buffer.concat([stdout, chunk]);
    });
    child.stderr.on("data", chunk => {
      if (stderr.length < 8192) stderr = Buffer.concat([stderr, chunk.subarray(0, 8192 - stderr.length)]);
    });
    child.once("error", error => {
      clearTimeout(outerTimeout);
      reject(new Error(error?.code === "ENOENT" ? "Docker CLI is not installed on the terminal worker." : "Terminal sandbox could not be started."));
    });
    child.once("close", async code => {
      clearTimeout(outerTimeout);
      // A named container lets the controller remove a job even after the Docker CLI is killed.
      await new Promise(done => {
        const cleanup = spawn(dockerBin, ["rm", "-f", containerName], {
          env: {
            PATH: process.env.PATH || "/usr/bin:/bin",
            ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}),
            ...(process.env.DOCKER_CONTEXT ? { DOCKER_CONTEXT: process.env.DOCKER_CONTEXT } : {})
          },
          stdio: "ignore",
          windowsHide: true
        });
        const finish = () => { clearTimeout(cleanupTimer); done(); };
        const cleanupTimer = setTimeout(() => { cleanup.kill("SIGKILL"); finish(); }, 3_000);
        cleanup.once("error", finish);
        cleanup.once("close", finish);
      });
      if (timedOut) return reject(new Error("Terminal sandbox exceeded its hard wall-clock limit."));
      if (outputOverflow) return reject(new Error("Terminal sandbox output exceeded the worker limit."));
      if (code !== 0) return reject(new Error(stderr.toString("utf8").slice(0, 500) || "Terminal sandbox process failed."));
      try {
        const result = JSON.parse(stdout.toString("utf8"));
        if (!result || !Number.isInteger(result.exitCode) || typeof result.stdout !== "string" ||
            typeof result.stderr !== "string" || !Array.isArray(result.files) || result.files.length > 50 ||
            result.files.some(file => !file || typeof file.path !== "string" || typeof file.contentBase64 !== "string")) {
          throw new Error("Invalid sandbox output.");
        }
        const seen = new Set();
        let exportedBytes = 0;
        for (const file of result.files) {
          const safePath = validateWorkspacePath(file.path);
          if (seen.has(safePath)) throw new Error("Duplicate exported path.");
          seen.add(safePath);
          const bytes = Buffer.from(file.contentBase64, "base64");
          if (bytes.toString("base64") !== file.contentBase64 || bytes.length > MAX_FILE_BYTES) throw new Error("Invalid exported file.");
          exportedBytes += bytes.length;
          if (exportedBytes > MAX_TOTAL_FILE_BYTES) throw new Error("Exported workspace exceeds its quota.");
        }
        result.files = result.files.map(file => ({ path: validateWorkspacePath(file.path), contentBase64: file.contentBase64 }));
        result.stdout = result.stdout.slice(0, 32 * 1024);
        result.stderr = result.stderr.slice(0, 32 * 1024);
        result.warnings = Array.isArray(result.warnings) ? result.warnings.slice(0, 30).map(item => String(item).slice(0, 240)) : [];
        result.totalBytes = exportedBytes;
        resolve(result);
      } catch {
        reject(new Error("Terminal sandbox returned an invalid result."));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ command: job.command, files: job.files, timeoutMs: job.timeoutMs }));
  });
}

export function createTerminalWorkerServer({
  token,
  host = "127.0.0.1",
  port = 4003,
  runSandbox = runTerminalSandbox
}) {
  if (typeof token !== "string" || Buffer.byteLength(token) < 32) throw new Error("TERMINAL_WORKER_TOKEN must contain at least 32 bytes.");
  if (typeof runSandbox !== "function") throw new Error("A sandbox runner is required.");
  let active = 0;
  const userWindows = new Map();
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      return sendJson(response, 200, { ok: true, state: active ? "busy" : "idle" });
    }
    if (request.method !== "POST" || request.url !== "/execute") return sendJson(response, 404, { error: "Not found." });
    if (!safeEqual(request.headers.authorization || "", `Bearer ${token}`)) return sendJson(response, 401, { error: "Unauthorized." });
    let job;
    try { job = await readJson(request); }
    catch (error) { return sendJson(response, 400, { error: String(error?.message || "Invalid job.").slice(0, 240) }); }
    if (active >= 2) return sendJson(response, 429, { error: "Terminal worker is busy; retry shortly." });
    const now = Date.now();
    const userWindow = userWindows.get(job.userId);
    if (!userWindow || now - userWindow.startedAt >= WINDOW_MS) userWindows.set(job.userId, { startedAt: now, count: 1 });
    else if (userWindow.count >= PER_USER_LIMIT) return sendJson(response, 429, { error: "Terminal quota exceeded. Try again later." });
    else userWindow.count += 1;
    for (const [id, value] of userWindows) if (now - value.startedAt >= WINDOW_MS) userWindows.delete(id);
    active += 1;
    try {
      const result = await runSandbox(job);
      return sendJson(response, 200, { result });
    } catch (error) {
      return sendJson(response, 502, { error: String(error?.message || "Terminal sandbox failed.").slice(0, 240) });
    } finally {
      active -= 1;
    }
  });
  server.requestTimeout = 20_000;
  server.headersTimeout = 5_000;
  server.maxHeadersCount = 32;
  return server;
}
