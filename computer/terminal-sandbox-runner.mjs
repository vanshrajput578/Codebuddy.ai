import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const WORKSPACE = "/workspace";
const MAX_INPUT_BYTES = 1_500_000;
const MAX_FILES = 30;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_FILE_BYTES = 1_000_000;
const MAX_OUTPUT_BYTES = 32 * 1024;
const MAX_EXPORTED_FILES = 50;
const MAX_DIRECTORIES = 100;
const MAX_COMMAND_CHARS = 4_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 15_000;

export function validateWorkspacePath(value) {
  if (typeof value !== "string" || !value || value.length > 240 ||
      value.startsWith("/") || value.startsWith("\\") ||
      value.includes("\\") || value.includes("\0")) {
    throw new Error("Workspace paths must be relative POSIX paths.");
  }
  const segments = value.split("/");
  if (segments.length > 12 || segments.some(part =>
    !part || part === "." || part === ".." || part.length > 80 ||
    /[<>:"|?*\x00-\x1f]/.test(part) || part.endsWith(".") || part.endsWith(" ")
  )) {
    throw new Error("Workspace path contains an unsafe segment.");
  }
  return segments.join("/");
}

async function ensureSafeDirectories(relativePath) {
  const parent = path.dirname(relativePath);
  if (parent === ".") return;
  let current = WORKSPACE;
  for (const segment of parent.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Workspace path traverses a non-directory.");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o700 });
    }
  }
}

async function materializeFiles(files) {
  if (!Array.isArray(files) || files.length > MAX_FILES) throw new Error("Workspace supports at most 30 input files.");
  const seen = new Set();
  let total = 0;
  for (const entry of files) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        Object.keys(entry).some(key => !["path", "contentBase64"].includes(key))) {
      throw new Error("Each workspace file must contain only path and contentBase64.");
    }
    const relative = validateWorkspacePath(entry.path);
    if (seen.has(relative)) throw new Error("Duplicate workspace file path.");
    seen.add(relative);
    if (typeof entry.contentBase64 !== "string" || entry.contentBase64.length > Math.ceil(MAX_FILE_BYTES * 4 / 3) + 8) {
      throw new Error("Workspace file content is invalid or too large.");
    }
    const bytes = Buffer.from(entry.contentBase64, "base64");
    if (bytes.toString("base64") !== entry.contentBase64 || bytes.length > MAX_FILE_BYTES) {
      throw new Error("Workspace file content must be valid base64 and at most 256 KiB.");
    }
    total += bytes.length;
    if (total > MAX_TOTAL_FILE_BYTES) throw new Error("Total workspace input is limited to 1 MiB.");
    await ensureSafeDirectories(relative);
    const target = path.join(WORKSPACE, relative);
    const handle = await open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(bytes); } finally { await handle.close(); }
  }
}

async function exportFiles() {
  const files = [];
  let total = 0;
  let directories = 0;
  const warnings = [];
  async function walk(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relative = prefix ? prefix + "/" + entry.name : entry.name;
      let info;
      try { info = await lstat(path.join(directory, entry.name)); }
      catch { continue; }
      if (info.isSymbolicLink()) {
        warnings.push("Skipped symbolic link: " + relative.slice(0, 240));
        continue;
      }
      if (info.isDirectory()) {
        directories += 1;
        if (directories > MAX_DIRECTORIES) {
          warnings.push("Directory export limit reached.");
          return;
        }
        await walk(path.join(directory, entry.name), relative);
      } else if (info.isFile()) {
        if (files.length >= MAX_EXPORTED_FILES) {
          warnings.push("File export limit reached.");
          return;
        }
        if (info.size > MAX_FILE_BYTES || total + info.size > MAX_TOTAL_FILE_BYTES) {
          warnings.push("Skipped file exceeding workspace export quota: " + relative.slice(0, 240));
          continue;
        }
        const bytes = await readFile(path.join(directory, entry.name));
        total += bytes.length;
        files.push({ path: relative, contentBase64: bytes.toString("base64"), size: bytes.length });
      }
    }
  }
  await walk(WORKSPACE);
  return { files, warnings, totalBytes: total };
}

async function readInput() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > MAX_INPUT_BYTES) throw new Error("Sandbox input exceeds 1.5 MiB.");
    chunks.push(chunk);
  }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("Sandbox input must be valid JSON."); }
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(key => !["command", "files", "timeoutMs"].includes(key))) {
    throw new Error("Sandbox input has unsupported fields.");
  }
  if (typeof input.command !== "string" || !input.command.trim() || input.command.length > MAX_COMMAND_CHARS) {
    throw new Error("Command must contain 1–4000 characters.");
  }
  const timeoutMs = input.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : input.timeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error("Command timeout must be between 1 and 15 seconds.");
  }
  return { command: input.command, files: input.files || [], timeoutMs };
}

async function runCommand(command, timeoutMs) {
  let stdout = "";
  let stderr = "";
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let outputTruncated = false;
  let timedOut = false;
  const child = spawn("/bin/sh", ["-lc", command], {
    cwd: WORKSPACE,
    env: {
      HOME: "/tmp",
      TMPDIR: "/tmp",
      PATH: "/usr/local/bin:/usr/bin:/bin",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8"
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const append = (current, chunk, currentBytes) => {
    const bytes = Buffer.from(chunk);
    const room = Math.max(0, MAX_OUTPUT_BYTES - currentBytes);
    const take = bytes.subarray(0, room);
    return { text: current + take.toString("utf8"), bytes: currentBytes + take.length, truncated: take.length < bytes.length };
  };
  child.stdout.on("data", chunk => {
    const result = append(stdout, chunk, stdoutBytes);
    stdout = result.text; stdoutBytes = result.bytes; outputTruncated ||= result.truncated;
  });
  child.stderr.on("data", chunk => {
    const result = append(stderr, chunk, stderrBytes);
    stderr = result.text; stderrBytes = result.bytes; outputTruncated ||= result.truncated;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => resolve(Number.isInteger(code) ? code : 128));
  }).finally(() => clearTimeout(timer));
  return { exitCode, stdout, stderr, timedOut, outputTruncated };
}

async function main() {
  try {
    const input = await readInput();
    await materializeFiles(input.files);
    const commandResult = await runCommand(input.command, input.timeoutMs);
    const workspace = await exportFiles();
    process.stdout.write(JSON.stringify({ ...commandResult, ...workspace }));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      exitCode: 125, stdout: "", stderr: String(error?.message || "Sandbox failed.").slice(0, 500),
      timedOut: false, outputTruncated: false, files: [], warnings: [], totalBytes: 0
    }));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
