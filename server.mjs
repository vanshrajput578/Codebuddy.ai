import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import pg from "pg";
import {
  createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual,
  createCipheriv, createDecipheriv
} from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const { Pool } = pg;
const scrypt = promisify(scryptCallback);
const app = express();
const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4000);
const appOrigin = process.env.APP_ORIGIN;
const providerNames = ["gemini", "openai", "openrouter", "anthropic"];
const providerDefaults = { gemini: "gemini-2.5-flash", openai: "gpt-4.1-mini", openrouter: "openai/gpt-4.1-mini", anthropic: "claude-3-5-haiku-latest" };
const providerLabels = { gemini: "Google Gemini", openai: "OpenAI", openrouter: "OpenRouter", anthropic: "Anthropic Claude" };
const providerRateLimit = rateLimit({ windowMs: 60_000, limit: 8, standardHeaders: "draft-8", legacyHeaders: false });
const secureCookies = process.env.NODE_ENV === "production";
const cookieName = secureCookies ? "__Host-nexus_session" : "nexus_session";
const sessionDays = 7;
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
}) : null;

app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
app.use(helmet({
  crossOriginResourcePolicy: { policy: "same-origin" },
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
    imgSrc: ["'self'", "data:"],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    upgradeInsecureRequests: []
  }}
}));
app.use(express.json({ limit: "16kb", strict: true }));

const authLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: 8, standardHeaders: "draft-8",
  legacyHeaders: false, message: { error: "Too many attempts. Try again later." }
});
const chatLimiter = rateLimit({
  windowMs: 60_000, limit: 10, standardHeaders: "draft-8",
  legacyHeaders: false, message: { error: "Too many requests. Try again in a minute." }
});

function noStore(_req, res, next) {
  res.set("Cache-Control", "no-store");
  next();
}
function sameOriginOnly(req, res, next) {
  const origin = req.get("origin");
  const fetchSite = req.get("sec-fetch-site");
  if (!appOrigin || origin !== appOrigin || (fetchSite && fetchSite !== "same-origin")) {
    return res.status(403).json({ error: "Request origin is not allowed." });
  }
  next();
}
function dbRequired(_req, res, next) {
  if (!pool) return res.status(503).json({ error: "Database is not configured on the server." });
  next();
}
function parseCookies(header = "") {
  const result = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    try { result[key] = decodeURIComponent(part.slice(index + 1).trim()); } catch {}
  }
  return result;
}
function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
function setSessionCookie(res, token) {
  const flags = [
    `${cookieName}=${encodeURIComponent(token)}`,
    "Path=/", "HttpOnly", "SameSite=Strict",
    `Max-Age=${sessionDays * 24 * 60 * 60}`
  ];
  if (secureCookies) flags.push("Secure");
  res.setHeader("Set-Cookie", flags.join("; "));
}
function clearSessionCookie(res) {
  const flags = [`${cookieName}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (secureCookies) flags.push("Secure");
  res.setHeader("Set-Cookie", flags.join("; "));
}
async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${salt.toString("hex")}$${Buffer.from(derived).toString("hex")}`;
}
async function verifyPassword(password, encoded) {
  const [algorithm, saltHex, hashHex] = String(encoded).split("$");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = Buffer.from(await scrypt(password, Buffer.from(saltHex, "hex"), expected.length, {
    N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024
  }));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function publicUser(row) {
  return { id: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at };
}
async function createSession(userId, res) {
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDays * 86400_000);
  await pool.query(
    "INSERT INTO sessions (user_id, token_hash, csrf_hash, expires_at) VALUES ($1,$2,$3,$4)",
    [userId, digest(token), digest(csrfToken), expiresAt]
  );
  setSessionCookie(res, token);
  return csrfToken;
}
async function requireAuth(req, res, next) {
  try {
    const token = parseCookies(req.headers.cookie)[cookieName];
    if (!token) return res.status(401).json({ error: "Sign in required." });
    const result = await pool.query(
      "SELECT u.id,u.email,u.display_name,u.created_at,s.id AS session_id,s.csrf_hash,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
      [digest(token)]
    );
    if (!result.rowCount) {
      clearSessionCookie(res);
      return res.status(401).json({ error: "Session expired. Sign in again." });
    }
    req.auth = result.rows[0];
    next();
  } catch {
    res.status(503).json({ error: "Authentication service unavailable." });
  }
}
function requireCsrf(req, res, next) {
  const supplied = req.get("x-csrf-token") || "";
  const expected = req.auth?.csrf_hash || "";
  const actualHash = digest(supplied);
  const a = Buffer.from(actualHash);
  const b = Buffer.from(expected);
  if (!supplied || a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(403).json({ error: "CSRF validation failed. Refresh your session and retry." });
  }
  next();
}

function encryptionKey() {
  const encoded = process.env.CREDENTIAL_ENCRYPTION_KEY || "";
  let key;
  try { key = Buffer.from(encoded, "base64"); } catch { key = Buffer.alloc(0); }
  if (key.length !== 32) throw new Error("Credential encryption is not configured.");
  return key;
}
function encryptCredential(plaintext, context) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), ciphertext: ciphertext.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}
function decryptCredential(row, context) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(row.iv, "base64"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(row.auth_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext, "base64")), decipher.final()
  ]).toString("utf8");
}
function providerConfig(provider, modelName) {
  if (!providerNames.includes(provider)) throw new Error("Unsupported provider.");
  const modelValue = typeof modelName === "string" ? modelName.trim() : "";
  if (!modelValue || modelValue.length > 120 || !/^[a-zA-Z0-9._:/-]+$/.test(modelValue)) {
    throw new Error("Invalid model identifier.");
  }
  return { provider, model: modelValue };
}
async function getProviderCredential(userId, provider) {
  const result = await pool.query(
    "SELECT ciphertext,iv,auth_tag,model_name FROM provider_credentials WHERE user_id=$1 AND provider=$2",
    [userId, provider]
  );
  if (!result.rowCount) return null;
  return { key: decryptCredential(result.rows[0], `${userId}:${provider}`), model: result.rows[0].model_name };
}
async function callProvider(provider, key, modelName, prompt, history = []) {
  if (provider === "gemini") {
    const contents = [...history, { role: "user", parts: [{ text: prompt }] }];
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents }), signal: AbortSignal.timeout(45_000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("Provider request failed.");
    return data.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("").trim() || "";
  }
  if (provider === "openai" || provider === "openrouter") {
    const endpoint = provider === "openai"
      ? "https://api.openai.com/v1/chat/completions"
      : "https://openrouter.ai/api/v1/chat/completions";
    const messages = [
      ...history.map(item => ({ role: item.role === "model" ? "assistant" : "user", content: item.parts?.map(part => part.text || "").join("") || "" })),
      { role: "user", content: prompt }
    ];
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
    if (provider === "openrouter") {
      headers["HTTP-Referer"] = appOrigin || "http://localhost";
      headers["X-Title"] = "NEXUS AI";
    }
    const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ model: modelName, messages }), signal: AbortSignal.timeout(45_000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("Provider request failed.");
    return data.choices?.[0]?.message?.content?.trim() || "";
  }
  if (provider === "anthropic") {
    const messages = [
      ...history.map(item => ({ role: item.role === "model" ? "assistant" : "user", content: item.parts?.map(part => part.text || "").join("") || "" })),
      { role: "user", content: prompt }
    ];
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: modelName, max_tokens: 4096, messages }), signal: AbortSignal.timeout(45_000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("Provider request failed.");
    return data.content?.filter(item => item.type === "text").map(item => item.text).join("").trim() || "";
  }
  throw new Error("Unsupported provider.");
}

async function rotateCsrf(req) {
  const token = randomBytes(32).toString("base64url");
  await pool.query("UPDATE sessions SET csrf_hash=$1 WHERE id=$2", [digest(token), req.auth.session_id]);
  return token;
}

app.get("/api/health", noStore, async (_req, res) => {
  let database = false;
  if (pool) {
    try { await pool.query("SELECT 1"); database = true; } catch {}
  }
  res.status(database ? 200 : 503).json({ ok: database, service: "nexus-api", database });
});

app.post("/api/auth/register", noStore, sameOriginOnly, dbRequired, authLimiter, async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = req.body?.password;
  const displayName = typeof req.body?.displayName === "string" ? req.body.displayName.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (typeof password !== "string" || password.length < 12 || password.length > 128) {
    return res.status(400).json({ error: "Password must be 12–128 characters." });
  }
  if (!displayName || displayName.length > 50) {
    return res.status(400).json({ error: "Display name must be 1–50 characters." });
  }
  try {
    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      "INSERT INTO users (email,display_name,password_hash) VALUES ($1,$2,$3) RETURNING id,email,display_name,created_at",
      [email, displayName, passwordHash]
    );
    const csrfToken = await createSession(result.rows[0].id, res);
    return res.status(201).json({ user: publicUser(result.rows[0]), csrfToken });
  } catch (error) {
    if (error?.code === "23505") return res.status(409).json({ error: "An account with this email already exists." });
    return res.status(503).json({ error: "Could not create account. Try again later." });
  }
});

app.post("/api/auth/login", noStore, sameOriginOnly, dbRequired, authLimiter, async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = req.body?.password;
  if (!email || typeof password !== "string" || password.length > 128) {
    return res.status(400).json({ error: "Enter your email and password." });
  }
  try {
    const result = await pool.query(
      "SELECT id,email,display_name,password_hash,created_at FROM users WHERE email=$1",
      [email]
    );
    const user = result.rows[0];
    const valid = user ? await verifyPassword(password, user.password_hash) : false;
    if (!valid) return res.status(401).json({ error: "Email or password is incorrect." });
    const csrfToken = await createSession(user.id, res);
    return res.json({ user: publicUser(user), csrfToken });
  } catch {
    return res.status(503).json({ error: "Sign-in service unavailable." });
  }
});

app.get("/api/auth/me", noStore, dbRequired, requireAuth, async (req, res) => {
  try {
    const csrfToken = await rotateCsrf(req);
    return res.json({ user: publicUser(req.auth), csrfToken });
  } catch {
    return res.status(503).json({ error: "Could not refresh session security token." });
  }
});

app.post("/api/auth/logout", noStore, sameOriginOnly, dbRequired, requireAuth, requireCsrf, async (req, res) => {
  try {
    await pool.query("DELETE FROM sessions WHERE id=$1", [req.auth.session_id]);
    clearSessionCookie(res);
    return res.json({ ok: true });
  } catch {
    return res.status(503).json({ error: "Could not end session." });
  }
});


app.get("/api/providers", noStore, dbRequired, requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT provider,model_name,created_at,updated_at FROM provider_credentials WHERE user_id=$1 ORDER BY provider",
      [req.auth.id]
    );
    const selected = await pool.query("SELECT provider FROM user_preferences WHERE user_id=$1", [req.auth.id]);
    return res.json({
      providers: result.rows.map(row => ({
        id: row.provider, name: providerLabels[row.provider], model: row.model_name,
        configured: true, keyHint: "••••••••", updatedAt: row.updated_at
      })),
      activeProvider: selected.rows[0]?.provider || null,
      supported: providerNames.map(id => ({ id, name: providerLabels[id], defaultModel: providerDefaults[id] }))
    });
  } catch {
    return res.status(503).json({ error: "Could not load provider settings." });
  }
});

app.put("/api/providers/:provider", noStore, sameOriginOnly, dbRequired, requireAuth, requireCsrf, authLimiter, async (req, res) => {
  const provider = req.params.provider;
  const apiKey = req.body?.apiKey;
  const requestedModel = req.body?.model || providerDefaults[provider];
  if (!providerNames.includes(provider)) return res.status(400).json({ error: "Unsupported provider." });
  if (typeof apiKey !== "string" || apiKey.trim().length < 12 || apiKey.length > 512 || /[\r\n]/.test(apiKey)) {
    return res.status(400).json({ error: "Enter a valid API key." });
  }
  let config;
  let encrypted;
  try {
    config = providerConfig(provider, requestedModel);
    encrypted = encryptCredential(apiKey.trim(), `${req.auth.id}:${provider}`);
  } catch {
    return res.status(400).json({ error: "Invalid provider settings or server encryption is not configured." });
  }
  try {
    await pool.query(
      `INSERT INTO provider_credentials (user_id,provider,model_name,ciphertext,iv,auth_tag)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id,provider) DO UPDATE SET model_name=EXCLUDED.model_name,ciphertext=EXCLUDED.ciphertext,iv=EXCLUDED.iv,auth_tag=EXCLUDED.auth_tag,updated_at=now()`,
      [req.auth.id, config.provider, config.model, encrypted.ciphertext, encrypted.iv, encrypted.authTag]
    );
    return res.json({ ok: true, provider, model: config.model, keyHint: "••••••••" });
  } catch {
    return res.status(503).json({ error: "Could not securely save provider credentials." });
  }
});

app.delete("/api/providers/:provider", noStore, sameOriginOnly, dbRequired, requireAuth, requireCsrf, async (req, res) => {
  if (!providerNames.includes(req.params.provider)) return res.status(400).json({ error: "Unsupported provider." });
  try {
    await pool.query("DELETE FROM provider_credentials WHERE user_id=$1 AND provider=$2", [req.auth.id, req.params.provider]);
    await pool.query("DELETE FROM user_preferences WHERE user_id=$1 AND provider=$2", [req.auth.id, req.params.provider]);
    return res.json({ ok: true });
  } catch {
    return res.status(503).json({ error: "Could not remove provider credentials." });
  }
});

app.put("/api/provider-selection", noStore, sameOriginOnly, dbRequired, requireAuth, requireCsrf, async (req, res) => {
  const provider = req.body?.provider;
  if (!providerNames.includes(provider)) return res.status(400).json({ error: "Unsupported provider." });
  try {
    const configured = await pool.query("SELECT 1 FROM provider_credentials WHERE user_id=$1 AND provider=$2", [req.auth.id, provider]);
    if (!configured.rowCount) return res.status(409).json({ error: "Add this provider's API key before selecting it." });
    await pool.query(
      `INSERT INTO user_preferences (user_id,provider) VALUES ($1,$2)
       ON CONFLICT (user_id) DO UPDATE SET provider=EXCLUDED.provider,updated_at=now()`,
      [req.auth.id, provider]
    );
    return res.json({ ok: true, activeProvider: provider });
  } catch {
    return res.status(503).json({ error: "Could not update active provider." });
  }
});

app.post("/api/providers/:provider/test", noStore, sameOriginOnly, dbRequired, requireAuth, requireCsrf, providerRateLimit, async (req, res) => {
  if (!providerNames.includes(req.params.provider)) return res.status(400).json({ error: "Unsupported provider." });
  try {
    const credential = await getProviderCredential(req.auth.id, req.params.provider);
    if (!credential) return res.status(404).json({ error: "Save an API key for this provider first." });
    const answer = await callProvider(req.params.provider, credential.key, credential.model, "Reply with exactly: NEXUS connection successful");
    if (!answer) return res.status(502).json({ error: "Provider returned an empty response." });
    return res.json({ ok: true, provider: req.params.provider, model: credential.model, message: "Connection successful." });
  } catch {
    return res.status(502).json({ error: "Provider connection failed. Check the key, model and provider status." });
  }
});



const memoryCategories = new Set(["note", "preference", "project", "personal"]);
const maxAgentSteps = 5;
const activeAgentTasks = new Set();
const agentToolNames = new Set(["memory.search", "memory.save", "response.compose"]);

function validUuid(value) {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}
function parseAgentPlan(raw) {
  const cleaned = String(raw || "").trim().replace(/^\x60\x60\x60(?:json)?\s*/i, "").replace(/\s*\x60\x60\x60$/, "");
  let parsed;
  try { parsed = JSON.parse(cleaned); } catch { throw new Error("Planner returned invalid JSON."); }
  if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length < 1 || parsed.steps.length > maxAgentSteps) {
    throw new Error("Plan must contain between 1 and 5 steps.");
  }
  const steps = parsed.steps.map((step, index) => {
    if (!step || typeof step !== "object" || !agentToolNames.has(step.tool)) throw new Error("Plan contains an unsupported tool.");
    const title = typeof step.title === "string" ? step.title.trim().slice(0, 100) : "";
    const description = typeof step.description === "string" ? step.description.trim().slice(0, 300) : "";
    if (!title || !description || !step.input || typeof step.input !== "object" || Array.isArray(step.input)) {
      throw new Error("Plan step is missing required fields.");
    }
    let input;
    if (step.tool === "memory.search") {
      const query = typeof step.input.query === "string" ? step.input.query.trim() : "";
      if (!query || query.length > 200) throw new Error("Memory search query is invalid.");
      input = { query };
    } else if (step.tool === "memory.save") {
      const category = step.input.category || "note";
      const content = typeof step.input.content === "string" ? step.input.content.trim() : "";
      if (!memoryCategories.has(category) || !content || content.length > 4000) throw new Error("Memory save input is invalid.");
      input = { category, content };
    } else {
      const text = typeof step.input.text === "string" ? step.input.text.trim() : "";
      if (!text || text.length > 4000) throw new Error("Response composition input is invalid.");
      input = { text };
    }
    return {
      id: index + 1, title, description, tool: step.tool, input,
      requiresApproval: step.tool === "memory.save", status: "pending"
    };
  });
  return { steps, maxSteps: maxAgentSteps };
}
function safeAgentPlan(plan) {
  return parseAgentPlan(JSON.stringify(plan));
}
async function appendTaskEvent(client, taskId, eventType, payload = {}) {
  await client.query(
    "INSERT INTO agent_task_events (task_id,event_type,payload) VALUES ($1,$2,$3::jsonb)",
    [taskId, eventType, JSON.stringify(payload)]
  );
}
async function executeAgentTool(client, userId, step) {
  if (step.tool === "memory.search") {
    const found = await client.query(
      "SELECT id,category,content FROM user_memories WHERE user_id=$1 AND content ILIKE $2 ORDER BY updated_at DESC LIMIT 5",
      [userId, `%${step.input.query}%`]
    );
    return { memories: found.rows };
  }
  if (step.tool === "memory.save") {
    const saved = await client.query(
      "INSERT INTO user_memories (user_id,category,content) VALUES ($1,$2,$3) RETURNING id,category,content",
      [userId, step.input.category, step.input.content]
    );
    return { saved: saved.rows[0] };
  }
  if (step.tool === "response.compose") return { text: step.input.text };
  throw new Error("Tool permission denied.");
}
async function runAgentTask(taskId, userId) {
  if (activeAgentTasks.has(taskId)) return;
  activeAgentTasks.add(taskId);
  try {
    for (let iteration = 0; iteration <= maxAgentSteps; iteration += 1) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const locked = await client.query(
          "SELECT id,status,plan,current_step FROM agent_tasks WHERE id=$1 AND user_id=$2 FOR UPDATE",
          [taskId, userId]
        );
        if (!locked.rowCount || locked.rows[0].status !== "running") {
          await client.query("COMMIT");
          return;
        }
        const task = locked.rows[0];
        const plan = safeAgentPlan(task.plan);
        const stepIndex = Number(task.current_step || 0);
        if (stepIndex >= plan.steps.length) {
          const lastResponse = [...plan.steps].reverse().find(step => step.tool === "response.compose" && step.result);
          const resultText = lastResponse?.result?.text || "Approved plan completed.";
          await client.query(
            "UPDATE agent_tasks SET status='completed',result=$1,updated_at=now() WHERE id=$2 AND user_id=$3",
            [String(resultText).slice(0, 4000), taskId, userId]
          );
          await appendTaskEvent(client, taskId, "task.completed", { status: "completed" });
          await client.query("COMMIT");
          return;
        }
        const step = plan.steps[stepIndex];
        const result = await executeAgentTool(client, userId, step);
        step.status = "completed";
        step.result = result;
        plan.steps[stepIndex] = step;
        await client.query(
          "UPDATE agent_tasks SET plan=$1::jsonb,current_step=$2,updated_at=now() WHERE id=$3 AND user_id=$4",
          [JSON.stringify(plan), stepIndex + 1, taskId, userId]
        );
        await appendTaskEvent(client, taskId, "tool.executed", {
          stepId: step.id, tool: step.tool, requiresApproval: step.requiresApproval,
          result: JSON.stringify(result).slice(0, 1200)
        });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        const failure = await pool.connect();
        try {
          await failure.query("BEGIN");
          const owned = await failure.query("SELECT status FROM agent_tasks WHERE id=$1 AND user_id=$2 FOR UPDATE", [taskId, userId]);
          if (owned.rowCount && owned.rows[0].status === "running") {
            await failure.query("UPDATE agent_tasks SET status='failed',result=$1,updated_at=now() WHERE id=$2 AND user_id=$3", ["Execution failed. Review the plan and try again.", taskId, userId]);
            await appendTaskEvent(failure, taskId, "task.failed", { reason: "A validated tool step failed." });
          }
          await failure.query("COMMIT");
        } catch {
          await failure.query("ROLLBACK").catch(() => {});
        } finally {
          failure.release();
        }
        return;
      } finally {
        client.release();
      }
    }
  } finally {
    activeAgentTasks.delete(taskId);
  }
}

app.get("/api/memory", noStore, dbRequired, requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id,category,content,created_at,updated_at FROM user_memories WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 100",
      [req.auth.id]
    );
    return res.json({ memories: result.rows });
  } catch {
    return res.status(503).json({ error: "Could not load saved memory." });
  }
});

app.post("/api/memory", noStore, sameOriginOnly, dbRequired, requireAuth, requireCsrf, authLimiter, async (req, res) => {
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  const category = req.body?.category || "note";
  if (!content || content.length > 4000 || !memoryCategories.has(category)) {
    return res.status(400).json({ error: "Memory must contain 1–4000 characters and use a supported category." });
  }
  try {
    const result = await pool.query(
      "INSERT INTO user_memories (user_id,category,content) VALUES ($1,$2,$3) RETURNING id,category,content,created_at,updated_at",
      [req.auth.id, category, content]
    );
    return res.status(201).json({ memory: result.rows[0] });
  } catch {
    return res.status(503).json({ error: "Could not save memory." });
  }
});

app.put("/api/memory/:id", noStore, sameOriginOnly, dbRequired, requireAuth, requireCsrf, async (req, res) => {
  if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid memory ID." });
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  const category = req.body?.category || "note";
  if (!content || content.length > 4000 || !memoryCategories.has(category)) {
    return res.status(400).json({ error: "Memory must contain 1–4000 characters and use a supported category." });
  }
  try {
    const result = await pool.query(
      "UPDATE user_memories SET category=$1,content=$2,updated_at=now() WHERE id=$3 AND user_id=$4 RETURNING id,category,content,created_at,updated_at",
      [category, content, req.params.id, req.auth.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Memory not found." });
    return res.json({ memory: result.rows[0] });
  } catch {
    return res.status(503).json({ error: "Could not update memory." });
  }
});

app.delete("/api/memory/:id", noStore, sameOriginOnly, dbRequired, requireAuth, requireCsrf, async (req, res) => {
  if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid memory ID." });
  try {
    const result = await pool.query("DELETE FROM user_memories WHERE id=$1 AND user_id=$2 RETURNING id", [req.params.id, req.auth.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Memory not found." });
    return res.json({ ok: true });
  } catch {
    return res.status(503).json({ error: "Could not delete memory." });
  }
});


app.post("/api/agent/tasks", noStore, sameOriginOnly, dbRequired, requireAuth, requireCsrf, chatLimiter, async (req, res) => {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  const titleInput = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  if (!prompt || prompt.length > 8000 || titleInput.length > 120) {
    return res.status(400).json({ error: "Task prompt must contain 1–8000 characters; title is limited to 120." });
  }
  const title = titleInput || prompt.replace(/\s+/g, " ").slice(0, 120);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created = await client.query(
      "INSERT INTO agent_tasks (user_id,title,prompt,status) VALUES ($1,$2,$3,'queued') RETURNING id,title,prompt,status,plan,current_step,created_at,updated_at",
      [req.auth.id, title, prompt]
    );
    await appendTaskEvent(client, created.rows[0].id, "task.created", { status: "queued" });
    await client.query("COMMIT");
    return res.status(201).json({ task: created.rows[0] });
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return res.status(503).json({ error: "Could not create durable task." });
  } finally {
    client.release();
  }
});

app.post("/api/agent/tasks/:id/plan", noStore, sameOriginOnly, dbRequired, requireAuth, requireCsrf, chatLimiter, async (req, res) => {
  if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid task ID." });
  const started = await pool.query(
    "UPDATE agent_tasks SET status='planning',updated_at=now() WHERE id=$1 AND user_id=$2 AND status='queued' RETURNING id,title,prompt",
    [req.params.id, req.auth.id]
  );
  if (!started.rowCount) {
    const owned = await pool.query("SELECT status FROM agent_tasks WHERE id=$1 AND user_id=$2", [req.params.id, req.auth.id]);
    return res.status(owned.rowCount ? 409 : 404).json({ error: owned.rowCount ? "Task is not in a plannable state." : "Task not found." });
  }
  try {
    await pool.query(
      "INSERT INTO agent_task_events (task_id,event_type,payload) VALUES ($1,'task.planning',$2::jsonb)",
      [req.params.id, JSON.stringify({ status: "planning" })]
    );
    const selected = await pool.query("SELECT provider FROM user_preferences WHERE user_id=$1", [req.auth.id]);
    const provider = selected.rows[0]?.provider;
    if (!provider) throw new Error("Configure an AI provider before planning tasks.");
    const credential = await getProviderCredential(req.auth.id, provider);
    if (!credential) throw new Error("The selected provider key is missing.");
    const planningPrompt = [
      "NEXUS_AGENT_PLAN_JSON",
      "Create a safe, short execution plan for the user's request.",
      "Return ONLY JSON with this shape: {\"steps\":[{\"title\":string,\"description\":string,\"tool\":string,\"input\":object}]}",
      "Allowed tools ONLY: memory.search with input {query:string}; memory.save with input {category:'note'|'preference'|'project'|'personal',content:string}; response.compose with input {text:string}.",
      "Never propose shell, browser, network, code execution, purchases, messages, calls, account changes, or tools not in this allowlist.",
      "Use 1 to 5 steps. Use memory.search only when relevant. memory.save is a write and will require explicit user approval. Always include one response.compose step as the final step.",
      "User task: " + started.rows[0].prompt
    ].join("\n");
    const rawPlan = await callProvider(provider, credential.key, credential.model, planningPrompt, []);
    const plan = parseAgentPlan(rawPlan);
    if (plan.steps.at(-1).tool !== "response.compose") throw new Error("Plan must end with response.compose.");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        "UPDATE agent_tasks SET status='awaiting_approval',plan=$1::jsonb,current_step=0,updated_at=now() WHERE id=$2 AND user_id=$3 AND status='planning' RETURNING id,title,prompt,status,plan,current_step,created_at,updated_at",
        [JSON.stringify(plan), req.params.id, req.auth.id]
      );
      if (!updated.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Task state changed while the plan was being generated." });
      }
      await appendTaskEvent(client, req.params.id, "task.plan_ready", {
        status: "awaiting_approval", stepCount: plan.steps.length,
        approvalRequired: plan.steps.some(step => step.requiresApproval)
      });
      await client.query("COMMIT");
      return res.json({ task: updated.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    await pool.query(
      "UPDATE agent_tasks SET status='failed',result=$1,updated_at=now() WHERE id=$2 AND user_id=$3 AND status='planning'",
      [String(error.message || "Planning failed.").slice(0, 300), req.params.id, req.auth.id]
    ).catch(() => {});
    await pool.query(
      "INSERT INTO agent_task_events (task_id,event_type,payload) VALUES ($1,'task.planning_failed',$2::jsonb)",
      [req.params.id, JSON.stringify({ reason: "Planner failed or returned an invalid plan." })]
    ).catch(() => {});
    return res.status(502).json({ error: "Could not create a safe plan. Check your provider and try again." });
  }
});

app.get("/api/agent/tasks", noStore, dbRequired, requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id,title,status,current_step,created_at,updated_at FROM agent_tasks WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 50",
      [req.auth.id]
    );
    return res.json({ tasks: result.rows });
  } catch {
    return res.status(503).json({ error: "Could not load tasks." });
  }
});

app.get("/api/agent/tasks/:id", noStore, dbRequired, requireAuth, async (req, res) => {
  if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid task ID." });
  try {
    const task = await pool.query(
      "SELECT id,title,prompt,status,plan,current_step,result,approved_at,created_at,updated_at FROM agent_tasks WHERE id=$1 AND user_id=$2",
      [req.params.id, req.auth.id]
    );
    if (!task.rowCount) return res.status(404).json({ error: "Task not found." });
    const events = await pool.query(
      "SELECT event_type,payload,created_at FROM agent_task_events WHERE task_id=$1 ORDER BY created_at ASC",
      [req.params.id]
    );
    return res.json({ task: task.rows[0], events: events.rows });
  } catch {
    return res.status(503).json({ error: "Could not load task details." });
  }
});

app.post("/api/agent/tasks/:id/approve", noStore, sameOriginOnly, dbRequired, requireAuth, requireCsrf, async (req, res) => {
  if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid task ID." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      "UPDATE agent_tasks SET status='running',approved_at=now(),updated_at=now() WHERE id=$1 AND user_id=$2 AND status='awaiting_approval' AND jsonb_typeof(plan)='object' RETURNING id,status",
      [req.params.id, req.auth.id]
    );
    if (!updated.rowCount) {
      const owned = await client.query("SELECT status FROM agent_tasks WHERE id=$1 AND user_id=$2", [req.params.id, req.auth.id]);
      await client.query("ROLLBACK");
      return res.status(owned.rowCount ? 409 : 404).json({ error: owned.rowCount ? "Task is not awaiting approval." : "Task not found." });
    }
    await appendTaskEvent(client, req.params.id, "task.approved", { actor: "user", status: "running" });
    await client.query("COMMIT");
    setImmediate(() => runAgentTask(req.params.id, req.auth.id));
    return res.status(202).json({ task: updated.rows[0] });
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return res.status(503).json({ error: "Could not approve task." });
  } finally {
    client.release();
  }
});

app.post("/api/agent/tasks/:id/reject", noStore, sameOriginOnly, dbRequired, requireAuth, requireCsrf, async (req, res) => {
  if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid task ID." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      "UPDATE agent_tasks SET status='cancelled',updated_at=now() WHERE id=$1 AND user_id=$2 AND status='awaiting_approval' RETURNING id,status",
      [req.params.id, req.auth.id]
    );
    if (!updated.rowCount) {
      const owned = await client.query("SELECT id FROM agent_tasks WHERE id=$1 AND user_id=$2", [req.params.id, req.auth.id]);
      await client.query("ROLLBACK");
      return res.status(owned.rowCount ? 409 : 404).json({ error: owned.rowCount ? "Task is not awaiting approval." : "Task not found." });
    }
    await appendTaskEvent(client, req.params.id, "task.rejected", { actor: "user", status: "cancelled" });
    await client.query("COMMIT");
    return res.json({ task: updated.rows[0] });
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return res.status(503).json({ error: "Could not reject task." });
  } finally {
    client.release();
  }
});

app.post("/api/agent/tasks/:id/pause", noStore, sameOriginOnly, dbRequired, requireAuth, requireCsrf, async (req, res) => {
  if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid task ID." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      "UPDATE agent_tasks SET status='paused',updated_at=now() WHERE id=$1 AND user_id=$2 AND status='running' RETURNING id,status",
      [req.params.id, req.auth.id]
    );
    if (!updated.rowCount) {
      const owned = await client.query("SELECT status FROM agent_tasks WHERE id=$1 AND user_id=$2", [req.params.id, req.auth.id]);
      await client.query("ROLLBACK");
      return res.status(owned.rowCount ? 409 : 404).json({ error: owned.rowCount ? "Task is not currently running." : "Task not found." });
    }
    await appendTaskEvent(client, req.params.id, "task.paused", { actor: "user" });
    await client.query("COMMIT");
    return res.json({ task: updated.rows[0] });
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return res.status(503).json({ error: "Could not pause task." });
  } finally {
    client.release();
  }
});

app.post("/api/agent/tasks/:id/resume", noStore, sameOriginOnly, dbRequired, requireAuth, requireCsrf, async (req, res) => {
  if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid task ID." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      "UPDATE agent_tasks SET status='running',updated_at=now() WHERE id=$1 AND user_id=$2 AND status='paused' RETURNING id,status",
      [req.params.id, req.auth.id]
    );
    if (!updated.rowCount) {
      const owned = await client.query("SELECT status FROM agent_tasks WHERE id=$1 AND user_id=$2", [req.params.id, req.auth.id]);
      await client.query("ROLLBACK");
      return res.status(owned.rowCount ? 409 : 404).json({ error: owned.rowCount ? "Task is not paused." : "Task not found." });
    }
    await appendTaskEvent(client, req.params.id, "task.resumed", { actor: "user" });
    await client.query("COMMIT");
    setImmediate(() => runAgentTask(req.params.id, req.auth.id));
    return res.status(202).json({ task: updated.rows[0] });
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return res.status(503).json({ error: "Could not resume task." });
  } finally {
    client.release();
  }
});

app.post("/api/agent/tasks/:id/cancel", noStore, sameOriginOnly, dbRequired, requireAuth, requireCsrf, async (req, res) => {
  if (!validUuid(req.params.id)) return res.status(400).json({ error: "Invalid task ID." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      "UPDATE agent_tasks SET status='cancelled',updated_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('queued','planning','awaiting_approval','running','paused') RETURNING id,status",
      [req.params.id, req.auth.id]
    );
    if (!updated.rowCount) {
      const owned = await client.query("SELECT id FROM agent_tasks WHERE id=$1 AND user_id=$2", [req.params.id, req.auth.id]);
      await client.query("ROLLBACK");
      return res.status(owned.rowCount ? 409 : 404).json({ error: owned.rowCount ? "Task cannot be cancelled in its current state." : "Task not found." });
    }
    await appendTaskEvent(client, req.params.id, "task.cancelled", { status: "cancelled", actor: "user" });
    await client.query("COMMIT");
    return res.json({ task: updated.rows[0] });
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return res.status(503).json({ error: "Could not cancel task." });
  } finally {
    client.release();
  }
});

app.get("/api/conversations", noStore, dbRequired, requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id,title,created_at,updated_at FROM conversations WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 40",
      [req.auth.id]
    );
    return res.json({ conversations: result.rows });
  } catch {
    return res.status(503).json({ error: "Could not load conversations." });
  }
});

app.get("/api/conversations/:id/messages", noStore, dbRequired, requireAuth, async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: "Invalid conversation ID." });
  try {
    const owned = await pool.query(
      "SELECT id FROM conversations WHERE id=$1 AND user_id=$2",
      [req.params.id, req.auth.id]
    );
    if (!owned.rowCount) return res.status(404).json({ error: "Conversation not found." });
    const result = await pool.query(
      "SELECT id,role,content,created_at FROM messages WHERE conversation_id=$1 ORDER BY created_at ASC LIMIT 200",
      [req.params.id]
    );
    return res.json({ messages: result.rows });
  } catch {
    return res.status(503).json({ error: "Could not load conversation messages." });
  }
});

app.delete("/api/conversations/:id", noStore, sameOriginOnly, dbRequired, requireAuth, requireCsrf, async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: "Invalid conversation ID." });
  try {
    const result = await pool.query(
      "DELETE FROM conversations WHERE id=$1 AND user_id=$2 RETURNING id",
      [req.params.id, req.auth.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Conversation not found." });
    return res.json({ ok: true });
  } catch {
    return res.status(503).json({ error: "Could not delete conversation." });
  }
});

app.post("/api/chat", noStore, sameOriginOnly, dbRequired, chatLimiter, requireAuth, requireCsrf, async (req, res) => {
  const message = req.body?.message;
  const requestedConversationId = req.body?.conversationId || null;
  if (typeof message !== "string" || !message.trim() || message.length > 8000) {
    return res.status(400).json({ error: "Message must be between 1 and 8000 characters." });
  }
  if (requestedConversationId && !/^[0-9a-f-]{36}$/i.test(requestedConversationId)) {
    return res.status(400).json({ error: "Invalid conversation ID." });
  }
  try {
    const active = await pool.query("SELECT provider FROM user_preferences WHERE user_id=$1", [req.auth.id]);
    const selectedProvider = active.rows[0]?.provider;
    if (!selectedProvider) return res.status(409).json({ error: "Configure an AI provider in Settings first." });
    const credential = await getProviderCredential(req.auth.id, selectedProvider);
    if (!credential) return res.status(409).json({ error: "The selected provider key is missing. Configure it in Settings." });
    let history = [];
    if (requestedConversationId) {
      const owned = await pool.query(
        "SELECT id FROM conversations WHERE id=$1 AND user_id=$2",
        [requestedConversationId, req.auth.id]
      );
      if (!owned.rowCount) return res.status(404).json({ error: "Conversation not found." });
      const prior = await pool.query(
        "SELECT role,content FROM messages WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 12",
        [requestedConversationId]
      );
      history = prior.rows.reverse().map(item => ({
        role: item.role === "assistant" ? "model" : "user",
        parts: [{ text: item.content.slice(0, 6000) }]
      }));
    }

    const answer = await callProvider(selectedProvider, credential.key, credential.model, message.trim(), history);
    if (typeof answer !== "string" || !answer.trim()) {
      return res.status(502).json({ error: "The AI provider returned an empty response." });
    }

    const client = await pool.connect();
    let conversationId = requestedConversationId;
    try {
      await client.query("BEGIN");
      if (!conversationId) {
        const title = message.trim().replace(/\s+/g, " ").slice(0, 80);
        const created = await client.query(
          "INSERT INTO conversations (user_id,title) VALUES ($1,$2) RETURNING id",
          [req.auth.id, title || "New conversation"]
        );
        conversationId = created.rows[0].id;
      } else {
        await client.query(
          "UPDATE conversations SET updated_at=now() WHERE id=$1 AND user_id=$2",
          [conversationId, req.auth.id]
        );
      }
      await client.query(
        "INSERT INTO messages (conversation_id,role,content) VALUES ($1,'user',$2),($1,'assistant',$3)",
        [conversationId, message.trim(), answer.trim()]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return res.json({ answer: answer.trim(), conversationId });
  } catch {
    return res.status(503).json({ error: "AI request or conversation save failed. Retry shortly." });
  }
});

app.use(express.static(path.join(appDirectory, "public"), { dotfiles: "deny", index: "index.html" }));

app.use((err, _req, res, _next) => {
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "Request body is too large." });
  return res.status(400).json({ error: "Invalid request." });
});

if (process.env.NODE_ENV !== "test" && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(port, () => console.log(`NEXUS API listening on port ${port}`));
}
export { app, pool };
