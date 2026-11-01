import { before, after, test } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.APP_ORIGIN = "http://127.0.0.1";
delete process.env.DATABASE_URL;
delete process.env.GEMINI_API_KEY;

const { app, pool } = await import("../server.mjs");
let server;
let baseUrl;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (pool) await pool.end();
});

test("health endpoint does not disclose secrets and fails closed without database", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = await response.text();
  assert.equal(response.status, 503);
  assert.equal(body.includes("GEMINI_API_KEY"), false);
  assert.equal(body.includes("DATABASE_URL"), false);
});

test("cross-origin registration is rejected before database access", async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://attacker.example" },
    body: JSON.stringify({ email: "person@example.com", password: "long-enough-password", displayName: "Person" })
  });
  assert.equal(response.status, 403);
});

test("same-origin auth fails closed when database is not configured", async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1" },
    body: JSON.stringify({ email: "person@example.com", password: "long-enough-password" })
  });
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes("password_hash"), false);
});

test("chat requires an authenticated database-backed session", async () => {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1" },
    body: JSON.stringify({ message: "hello" })
  });
  assert.equal(response.status, 503);
});

test("static frontend is served by the same-origin backend", async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /text\/html/);
  const html = await response.text();
  assert.match(html, /Sign in to NEXUS/);
  assert.match(html, /id="providerSettings"/);
  assert.match(html, /data-view="settings"/);
  assert.match(html, /Conversations are saved to your account/);
  assert.ok(response.headers.get("content-security-policy"));
});

test("provider vault endpoints fail closed without database configuration", async () => {
  const response = await fetch(`${baseUrl}/api/providers`);
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes("ciphertext"), false);
});

test("provider credential routes reject cross-origin requests before touching the database", async () => {
  const response = await fetch(`${baseUrl}/api/providers/openai`, {
    method: "PUT",
    headers: { "content-type": "application/json", origin: "https://attacker.example" },
    body: JSON.stringify({ apiKey: "test-secret-value", model: "gpt-4.1-mini" })
  });
  assert.equal(response.status, 403);
  assert.equal((await response.text()).includes("test-secret-value"), false);
});
