import { parseBrowserUrl } from "../computer/browser-policy.mjs";
import { validateWorkspacePath } from "../computer/terminal-sandbox-runner.mjs";

const memoryCategories = new Set(["note", "preference", "project", "personal"]);

const toolDefinitions = [
  { id: "memory.search", description: "Search the user's saved private memories. Input: {query:string}. Read-only.", requiresApproval: false },
  { id: "memory.save", description: "Save a note to the user's private memory. Input: {category:'note'|'preference'|'project'|'personal',content:string}. Requires user approval.", requiresApproval: true },
  { id: "math.calculate", description: "Safely calculate a basic arithmetic expression using numbers, parentheses, +, -, *, /, %, and ^. Input: {expression:string}. No code execution.", requiresApproval: false },
  { id: "time.now", description: "Get the current date and time in an IANA timezone. Input: {timezone?:string}; defaults to Asia/Kolkata.", requiresApproval: false },
  { id: "browser.open", description: "Open one public HTTP(S) webpage in the isolated read-only browser and extract its visible text. Input: {url:string}. Outbound browsing requires explicit plan approval. Set replanAfter=true so the next step can use page evidence.", requiresApproval: true },
  { id: "terminal.run", description: "Run one command in a disposable non-root, no-network terminal sandbox and transfer a bounded set of project files in and out. Input: {command:string,files?:[{path:string,contentBase64:string}],timeoutMs?:number}. Every command requires explicit plan approval. Set replanAfter=true to use command output.", requiresApproval: true },
  { id: "response.compose", description: "Return the final response text. Input: {text:string}. Must be the final plan step.", requiresApproval: false }
];

const toolById = new Map(toolDefinitions.map(tool => [tool.id, tool]));

export function getAgentToolNames() {
  return toolDefinitions.map(tool => tool.id);
}

export function getAgentToolPrompt() {
  return toolDefinitions.map(tool => `- ${tool.id}: ${tool.description}`).join("\n");
}

export function isAgentToolApprovalRequired(toolId) {
  const tool = toolById.get(toolId);
  if (!tool) throw new Error("Unsupported agent tool.");
  return tool.requiresApproval;
}

function requireText(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`Invalid ${field}.`);
  }
  return value.trim();
}

export function validateAgentToolInput(toolId, rawInput) {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    throw new Error("Tool input must be an object.");
  }

  switch (toolId) {
    case "memory.search":
      return { query: requireText(rawInput.query, "memory search query", 200) };
    case "memory.save": {
      const category = rawInput.category || "note";
      if (!memoryCategories.has(category)) throw new Error("Invalid memory category.");
      return { category, content: requireText(rawInput.content, "memory content", 4000) };
    }
    case "math.calculate":
      return { expression: requireText(rawInput.expression, "math expression", 120) };
    case "browser.open": {
      const url = parseBrowserUrl(requireText(rawInput.url, "browser URL", 2048));
      return { url: url.href };
    }
    case "terminal.run": {
      const command = requireText(rawInput.command, "terminal command", 4000);
      const timeoutMs = rawInput.timeoutMs === undefined ? 10_000 : rawInput.timeoutMs;
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 15_000) {
        throw new Error("Terminal timeout must be between 1 and 15 seconds.");
      }
      const files = rawInput.files === undefined ? [] : rawInput.files;
      if (!Array.isArray(files) || files.length > 30) throw new Error("Terminal workspace supports at most 30 files.");
      const seen = new Set();
      let total = 0;
      const normalizedFiles = files.map(file => {
        if (!file || typeof file !== "object" || Array.isArray(file) ||
            Object.keys(file).some(key => !["path", "contentBase64"].includes(key))) {
          throw new Error("Invalid terminal workspace file.");
        }
        const filePath = validateWorkspacePath(file.path);
        if (seen.has(filePath)) throw new Error("Duplicate terminal workspace path.");
        seen.add(filePath);
        if (typeof file.contentBase64 !== "string" || file.contentBase64.length > 350_000) {
          throw new Error("Terminal workspace file content is invalid or too large.");
        }
        const bytes = Buffer.from(file.contentBase64, "base64");
        if (bytes.toString("base64") !== file.contentBase64 || bytes.length > 256 * 1024) {
          throw new Error("Terminal files must use valid base64 and be at most 256 KiB each.");
        }
        total += bytes.length;
        if (total > 1_000_000) throw new Error("Terminal workspace input is limited to 1 MiB.");
        return { path: filePath, contentBase64: file.contentBase64 };
      });
      return { command, files: normalizedFiles, timeoutMs };
    }
    case "time.now": {
      const timezone = rawInput.timezone === undefined ? "Asia/Kolkata" : requireText(rawInput.timezone, "timezone", 64);
      try {
        new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date());
      } catch {
        throw new Error("Invalid IANA timezone.");
      }
      return { timezone };
    }
    case "response.compose":
      return { text: requireText(rawInput.text, "response text", 4000) };
    default:
      throw new Error("Unsupported agent tool.");
  }
}

function calculateExpression(expression) {
  const source = expression.trim();
  if (!source || source.length > 120) throw new Error("Expression is empty or too long.");

  const tokens = [];
  const tokenPattern = /\s*([0-9]+(?:\.[0-9]+)?|[()+\-*\/%^])/gy;
  let position = 0;
  while (position < source.length) {
    tokenPattern.lastIndex = position;
    const match = tokenPattern.exec(source);
    if (!match) throw new Error("Expression contains an unsupported character or operator.");
    tokens.push(match[1]);
    position = tokenPattern.lastIndex;
    if (tokens.length > 80) throw new Error("Expression contains too many tokens.");
  }

  let cursor = 0;
  const peek = () => tokens[cursor];
  const take = () => tokens[cursor++];
  const finite = value => {
    if (!Number.isFinite(value) || Math.abs(value) > 1e100) throw new Error("Calculation result is outside the supported range.");
    return value;
  };

  function primary() {
    const token = take();
    if (token === "(") {
      const value = expressionSum();
      if (take() !== ")") throw new Error("Missing closing parenthesis.");
      return value;
    }
    if (!token || !/^(?:[0-9]+(?:\.[0-9]+)?)$/.test(token)) throw new Error("Expected a number.");
    return Number(token);
  }
  function power() {
    const left = primary();
    if (peek() === "^") {
      take();
      const right = unary();
      if (Math.abs(right) > 12) throw new Error("Exponent magnitude is limited to 12.");
      return finite(left ** right);
    }
    return left;
  }
  function unary() {
    if (peek() === "+") { take(); return unary(); }
    if (peek() === "-") { take(); return -unary(); }
    return power();
  }
  function expressionProduct() {
    let value = unary();
    while (["*", "/", "%"].includes(peek())) {
      const operator = take();
      const right = unary();
      if ((operator === "/" || operator === "%") && right === 0) throw new Error("Division by zero is not allowed.");
      if (operator === "*") value = finite(value * right);
      if (operator === "/") value = finite(value / right);
      if (operator === "%") value = finite(value % right);
    }
    return value;
  }
  function expressionSum() {
    let value = expressionProduct();
    while (peek() === "+" || peek() === "-") {
      const operator = take();
      const right = expressionProduct();
      value = finite(operator === "+" ? value + right : value - right);
    }
    return value;
  }

  const result = expressionSum();
  if (cursor !== tokens.length) throw new Error("Expression has unexpected trailing tokens.");
  return Number(result.toPrecision(12));
}

export async function executeAgentTool(client, userId, toolId, rawInput) {
  const input = validateAgentToolInput(toolId, rawInput);
  switch (toolId) {
    case "memory.search": {
      const found = await client.query(
        "SELECT id,category,content FROM user_memories WHERE user_id=$1 AND content ILIKE $2 ORDER BY updated_at DESC LIMIT 5",
        [userId, `%${input.query}%`]
      );
      return { memories: found.rows };
    }
    case "memory.save": {
      const saved = await client.query(
        "INSERT INTO user_memories (user_id,category,content) VALUES ($1,$2,$3) RETURNING id,category,content",
        [userId, input.category, input.content]
      );
      return { saved: saved.rows[0] };
    }
    case "browser.open": {
      const workerUrl = process.env.BROWSER_WORKER_URL || "http://127.0.0.1:4002";
      const token = process.env.BROWSER_WORKER_TOKEN || "";
      if (Buffer.byteLength(token) < 32) throw new Error("The isolated browser worker is not configured.");
      let endpoint;
      try {
        const base = new URL(workerUrl);
        if (!["http:", "https:"].includes(base.protocol) || !base.hostname) throw new Error("Invalid worker URL.");
        endpoint = new URL("/execute", base);
      } catch {
        throw new Error("The isolated browser worker URL is invalid.");
      }
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId, url: input.url }),
        signal: AbortSignal.timeout(20_000)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.result || typeof payload.result.text !== "string") {
        throw new Error(`The isolated browser worker failed (HTTP ${response.status}).`);
      }
      return {
        url: String(payload.result.url || input.url).slice(0, 2048),
        title: String(payload.result.title || "").slice(0, 300),
        status: Number.isInteger(payload.result.status) ? payload.result.status : null,
        text: payload.result.text.slice(0, 12_000)
      };
    }
    case "math.calculate":
      return { expression: input.expression, value: calculateExpression(input.expression) };
    case "time.now": {
      const now = new Date();
      return {
        iso: now.toISOString(),
        timezone: input.timezone,
        local: new Intl.DateTimeFormat("en-IN", {
          dateStyle: "full", timeStyle: "long", timeZone: input.timezone
        }).format(now)
      };
    }
    case "response.compose":
      return { text: input.text };
    default:
      throw new Error("Unsupported agent tool.");
  }
}


/**
 * Build a bounded final answer from the approved response text and persisted tool outputs.
 * Tool output is treated as data, never as executable instructions.
 */
export function composeAgentResult(steps) {
  if (!Array.isArray(steps)) throw new Error("Agent steps must be an array.");
  const responseStep = [...steps].reverse().find(step =>
    step?.tool === "response.compose" && step?.status === "completed" && typeof step?.result?.text === "string"
  );
  const responseText = (responseStep?.result?.text || "The approved task completed.").trim();
  const evidence = steps
    .filter(step => step?.status === "completed" && step?.tool !== "response.compose")
    .map(step => {
      let serialized;
      try { serialized = JSON.stringify(step.result); } catch { serialized = '"[unavailable]"'; }
      return "- " + String(step.tool || "tool").slice(0, 60) + ": " + String(serialized || "null").slice(0, 700);
    });
  const suffix = evidence.length ? "\n\nVerified execution results:\n" + evidence.join("\n") : "";
  return (responseText + suffix).slice(0, 4000);
}
