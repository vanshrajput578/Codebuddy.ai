import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeAgentResult, executeAgentTool, getAgentToolNames, getAgentToolPrompt,
  isAgentToolApprovalRequired, validateAgentToolInput
} from "../agent/tool-registry.mjs";

test("registry exposes only explicitly registered tools", () => {
  assert.deepEqual(getAgentToolNames(), [
    "memory.search", "memory.save", "math.calculate", "time.now", "browser.open", "terminal.run", "response.compose"
  ]);
  assert.match(getAgentToolPrompt(), /math.calculate/);
  assert.throws(() => isAgentToolApprovalRequired("shell.exec"), /Unsupported/);
});

test("memory writes require approval while read-only tools do not", () => {
  assert.equal(isAgentToolApprovalRequired("memory.save"), true);
  assert.equal(isAgentToolApprovalRequired("memory.search"), false);
  assert.equal(isAgentToolApprovalRequired("math.calculate"), false);
  assert.equal(isAgentToolApprovalRequired("time.now"), false);
  assert.equal(isAgentToolApprovalRequired("browser.open"), true);
  assert.equal(isAgentToolApprovalRequired("terminal.run"), true);
});

test("tool inputs are normalized and bounded", () => {
  assert.deepEqual(validateAgentToolInput("math.calculate", { expression: " 2 + 3 " }), { expression: "2 + 3" });
  assert.deepEqual(validateAgentToolInput("time.now", {}), { timezone: "Asia/Kolkata" });
  assert.deepEqual(validateAgentToolInput("browser.open", { url: "https://example.com/path" }), { url: "https://example.com/path" });
  assert.throws(() => validateAgentToolInput("browser.open", { url: "http://127.0.0.1/" }), /Private/);
  assert.deepEqual(validateAgentToolInput("terminal.run", { command: "pwd", files: [] }), {
    command: "pwd", files: [], timeoutMs: 10_000
  });
  assert.throws(() => validateAgentToolInput("terminal.run", { command: "pwd", files: [{ path: "../escape", contentBase64: "eA==" }] }), /unsafe|path|relative/i);
  assert.throws(() => validateAgentToolInput("terminal.run", { command: "pwd", timeoutMs: 30_000 }), /timeout/i);
  assert.throws(() => validateAgentToolInput("memory.search", { query: "" }), /Invalid/);
  assert.throws(() => validateAgentToolInput("memory.save", { category: "admin", content: "x" }), /category/);
  assert.throws(() => validateAgentToolInput("time.now", { timezone: "Not/AZone" }), /timezone/);
  assert.throws(() => validateAgentToolInput("shell.exec", { command: "whoami" }), /Unsupported/);
});

test("calculator evaluates arithmetic without eval or code execution", async () => {
  const result = await executeAgentTool(null, "user-id", "math.calculate", { expression: "(12 + 8) / 4 * 3" });
  assert.equal(result.value, 15);
  assert.equal(result.expression, "(12 + 8) / 4 * 3");
  const exponent = await executeAgentTool(null, "user-id", "math.calculate", { expression: "2^3^2" });
  assert.equal(exponent.value, 512);
});

test("calculator rejects unsafe syntax, division by zero and oversized exponents", async () => {
  for (const expression of ["process.exit()", "1/0", "2^13", "1 + (2", "1; console.log(1)"]) {
    await assert.rejects(
      executeAgentTool(null, "user-id", "math.calculate", { expression }),
      /unsupported|zero|Exponent|parenthesis|trailing|number/i
    );
  }
});

test("time tool returns an ISO timestamp and requested timezone", async () => {
  const result = await executeAgentTool(null, "user-id", "time.now", { timezone: "Asia/Kolkata" });
  assert.equal(result.timezone, "Asia/Kolkata");
  assert.ok(Number.isFinite(Date.parse(result.iso)));
  assert.ok(result.local.length > 0);
});

test("database tools are scoped to the supplied user", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{ id: "memory-1", category: "note", content: "private note" }] };
    }
  };
  const result = await executeAgentTool(client, "owner-id", "memory.search", { query: "private" });
  assert.equal(result.memories.length, 1);
  assert.equal(calls[0].values[0], "owner-id");
  assert.equal(calls[0].values[1], "%private%");
});


test("final answer includes bounded results from completed tools", () => {
  const result = composeAgentResult([
    { tool: "memory.search", status: "completed", result: { memories: [{ content: "Project note" }] } },
    { tool: "math.calculate", status: "completed", result: { expression: "2+2", value: 4 } },
    { tool: "response.compose", status: "completed", result: { text: "Task completed." } }
  ]);
  assert.match(result, /^Task completed\./);
  assert.match(result, /memory\.search/);
  assert.match(result, /Project note/);
  assert.match(result, /math\.calculate/);
  assert.match(result, /"value":4/);
  assert.ok(result.length <= 4000);
});

test("final answer safely handles absent or malformed tool output", () => {
  assert.equal(composeAgentResult([]), "The approved task completed.");
  assert.ok(composeAgentResult([{ tool: "math.calculate", status: "completed", result: null }]).includes("math.calculate"));
});


test("browser tool calls only the authenticated internal worker and returns bounded page data", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.BROWSER_WORKER_TOKEN;
  const originalUrl = process.env.BROWSER_WORKER_URL;
  const captured = {};
  process.env.BROWSER_WORKER_TOKEN = "browser-worker-secret-token-that-is-long-enough";
  process.env.BROWSER_WORKER_URL = "http://nexus-browser-worker:4002";
  globalThis.fetch = async (url, options) => {
    captured.url = String(url);
    captured.options = options;
    return new Response(JSON.stringify({
      result: { url: "https://example.com/", title: "Example", status: 200, text: "Visible public content" }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await executeAgentTool(null, "8c6e7cb2-8c3a-4c3b-9f52-0c9f8b4d0a12", "browser.open", { url: "https://example.com/" });
    assert.deepEqual(result, {
      url: "https://example.com/", title: "Example", status: 200, text: "Visible public content"
    });
    assert.equal(captured.url, "http://nexus-browser-worker:4002/execute");
    assert.equal(captured.options.method, "POST");
    assert.equal(captured.options.headers.authorization, `Bearer ${process.env.BROWSER_WORKER_TOKEN}`);
    assert.deepEqual(JSON.parse(captured.options.body), { userId: "owner-id", url: "https://example.com/" });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.BROWSER_WORKER_TOKEN;
    else process.env.BROWSER_WORKER_TOKEN = originalToken;
    if (originalUrl === undefined) delete process.env.BROWSER_WORKER_URL;
    else process.env.BROWSER_WORKER_URL = originalUrl;
  }
});

test("browser tool fails closed when the isolated worker is not configured", async () => {
  const originalToken = process.env.BROWSER_WORKER_TOKEN;
  delete process.env.BROWSER_WORKER_TOKEN;
  try {
    await assert.rejects(executeAgentTool(null, "8c6e7cb2-8c3a-4c3b-9f52-0c9f8b4d0a12", "browser.open", { url: "https://example.com" }), /not configured/);
  } finally {
    if (originalToken === undefined) delete process.env.BROWSER_WORKER_TOKEN;
    else process.env.BROWSER_WORKER_TOKEN = originalToken;
  }
});


test("terminal tool calls only the private worker with bounded file transfer", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.TERMINAL_WORKER_TOKEN;
  const originalUrl = process.env.TERMINAL_WORKER_URL;
  const captured = {};
  const token = "terminal-worker-test-token-that-is-long-enough";
  process.env.TERMINAL_WORKER_TOKEN = token;
  process.env.TERMINAL_WORKER_URL = "http://nexus-terminal-worker:4003";
  const fileContent = Buffer.from("hello terminal");
  globalThis.fetch = async (url, options) => {
    captured.url = String(url);
    captured.options = options;
    return new Response(JSON.stringify({
      result: {
        exitCode: 0, stdout: "hello terminal", stderr: "", timedOut: false,
        outputTruncated: false,
        files: [{ path: "README.md", contentBase64: fileContent.toString("base64") }],
        warnings: []
      }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await executeAgentTool(null, "8c6e7cb2-8c3a-4c3b-9f52-0c9f8b4d0a12", "terminal.run", {
      command: "cat README.md",
      files: [{ path: "README.md", contentBase64: fileContent.toString("base64") }]
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "hello terminal");
    assert.equal(result.files[0].path, "README.md");
    assert.equal(captured.url, "http://nexus-terminal-worker:4003/execute");
    assert.equal(captured.options.headers.authorization, `Bearer ${token}`);
    const body = JSON.parse(captured.options.body);
    assert.equal(body.command, "cat README.md");
    assert.equal(body.userId, "8c6e7cb2-8c3a-4c3b-9f52-0c9f8b4d0a12");
    assert.equal(body.files[0].path, "README.md");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.TERMINAL_WORKER_TOKEN;
    else process.env.TERMINAL_WORKER_TOKEN = originalToken;
    if (originalUrl === undefined) delete process.env.TERMINAL_WORKER_URL;
    else process.env.TERMINAL_WORKER_URL = originalUrl;
  }
});

test("terminal tool fails closed when its controller is not configured", async () => {
  const originalToken = process.env.TERMINAL_WORKER_TOKEN;
  delete process.env.TERMINAL_WORKER_TOKEN;
  try {
    await assert.rejects(
      executeAgentTool(null, "8c6e7cb2-8c3a-4c3b-9f52-0c9f8b4d0a12", "terminal.run", { command: "id" }),
      /not configured/
    );
  } finally {
    if (originalToken === undefined) delete process.env.TERMINAL_WORKER_TOKEN;
    else process.env.TERMINAL_WORKER_TOKEN = originalToken;
  }
});
