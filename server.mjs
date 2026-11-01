import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { GoogleGenAI } from "@google/genai";
import pg from "pg";
import {
  createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual
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
const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
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

app.post("/api/chat", noStore, sameOriginOnly, dbRequired, chatLimiter, requireAuth, requireCsrf, async (req, res) => {
  const message = req.body?.message;
  if (typeof message !== "string" || !message.trim() || message.length > 8000) {
    return res.status(400).json({ error: "Message must be between 1 and 8000 characters." });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: "AI provider is not configured on the server." });
  }
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const result = await ai.models.generateContent({ model, contents: message.trim() });
    const answer = result.text;
    if (typeof answer !== "string" || !answer.trim()) {
      return res.status(502).json({ error: "The AI provider returned an empty response." });
    }
    return res.json({ answer });
  } catch {
    return res.status(502).json({ error: "AI request failed. Check the server configuration and provider status." });
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
