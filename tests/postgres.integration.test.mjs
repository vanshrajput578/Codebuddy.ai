import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

if (!process.env.DATABASE_URL) {
  test("PostgreSQL integration suite requires DATABASE_URL", { skip: true }, () => {});
} else {
  process.env.NODE_ENV = "test";
  process.env.APP_ORIGIN = "http://127.0.0.1:43127";
  process.env.CREDENTIAL_ENCRYPTION_KEY = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";

  const { app, pool } = await import("../server.mjs");
  const origin = process.env.APP_ORIGIN;
  const baseUrl = origin;
  let server;

  async function register(email) {
    const response = await fetch(baseUrl + "/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email, password: "Strong-test-password-123", displayName: "Integration Test" })
    });
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie, "registration should set a session cookie");
    assert.ok(body.csrfToken, "registration should return a CSRF token");
    return { user: body.user, cookie, csrf: body.csrfToken };
  }

  test("PostgreSQL account, provider vault, CSRF and ownership flows", async () => {
    const schema = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
    await pool.query(schema);
    server = app.listen(43127, "127.0.0.1");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });

    const suffix = randomUUID();
    const first = await register(`nexus-one-${suffix}@example.test`);
    const second = await register(`nexus-two-${suffix}@example.test`);

    try {
      const missingCsrf = await fetch(baseUrl + "/api/providers/openai", {
        method: "PUT",
        headers: { "content-type": "application/json", origin, cookie: first.cookie },
        body: JSON.stringify({ apiKey: "sk-test-secret-123456789", model: "gpt-4.1-mini" })
      });
      assert.equal(missingCsrf.status, 403, "provider writes must require CSRF");

      const apiKey = "sk-test-secret-123456789";
      const save = await fetch(baseUrl + "/api/providers/openai", {
        method: "PUT",
        headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
        body: JSON.stringify({ apiKey, model: "gpt-4.1-mini" })
      });
      assert.equal(save.status, 200, await save.text().catch(() => ""));
      const savedBody = await save.json();
      assert.equal(savedBody.ok, true);
      assert.equal(JSON.stringify(savedBody).includes(apiKey), false, "save response must not expose key");

      const stored = await pool.query(
        "SELECT ciphertext,iv,auth_tag FROM provider_credentials WHERE user_id=$1 AND provider='openai'",
        [first.user.id]
      );
      assert.equal(stored.rowCount, 1);
      assert.notEqual(stored.rows[0].ciphertext, apiKey, "database must not contain plaintext API key");
      assert.ok(stored.rows[0].iv);
      assert.ok(stored.rows[0].auth_tag);

      const list = await fetch(baseUrl + "/api/providers", { headers: { cookie: first.cookie } });
      const listBody = await list.json();
      assert.equal(list.status, 200);
      assert.equal(listBody.providers.length, 1);
      assert.equal(JSON.stringify(listBody).includes(apiKey), false, "provider list must not expose key");

      const otherList = await fetch(baseUrl + "/api/providers", { headers: { cookie: second.cookie } });
      assert.equal((await otherList.json()).providers.length, 0, "provider keys must be isolated per user");

      const select = await fetch(baseUrl + "/api/provider-selection", {
        method: "PUT",
        headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
        body: JSON.stringify({ provider: "openai" })
      });
      assert.equal(select.status, 200);
      assert.equal((await select.json()).activeProvider, "openai");

      const conversation = await pool.query(
        "INSERT INTO conversations (user_id,title) VALUES ($1,$2) RETURNING id",
        [first.user.id, "Integration conversation"]
      );
      await pool.query(
        "INSERT INTO messages (conversation_id,role,content) VALUES ($1,'user','hello'),($1,'assistant','hi')",
        [conversation.rows[0].id]
      );

      const ownMessages = await fetch(baseUrl + `/api/conversations/${conversation.rows[0].id}/messages`, {
        headers: { cookie: first.cookie }
      });
      assert.equal(ownMessages.status, 200);
      assert.equal((await ownMessages.json()).messages.length, 2);

      const foreignMessages = await fetch(baseUrl + `/api/conversations/${conversation.rows[0].id}/messages`, {
        headers: { cookie: second.cookie }
      });
      assert.equal(foreignMessages.status, 404, "users must not read another user's conversation");

      const corrupt = await pool.query(
        "UPDATE provider_credentials SET auth_tag=$1 WHERE user_id=$2 AND provider='openai' RETURNING auth_tag",
        ["AAAAAAAAAAAAAAAAAAAAAA==", first.user.id]
      );
      assert.equal(corrupt.rowCount, 1);
      const tamperTest = await fetch(baseUrl + "/api/providers/openai/test", {
        method: "POST",
        headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
        body: "{}"
      });
      assert.equal(tamperTest.status, 502, "tampered ciphertext must fail authentication before provider call");

      const remove = await fetch(baseUrl + "/api/providers/openai", {
        method: "DELETE",
        headers: { origin, cookie: first.cookie, "x-csrf-token": first.csrf }
      });
      assert.equal(remove.status, 200);
      const remaining = await pool.query("SELECT 1 FROM provider_credentials WHERE user_id=$1", [first.user.id]);
      assert.equal(remaining.rowCount, 0);

      const logout = await fetch(baseUrl + "/api/auth/logout", {
        method: "POST",
        headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
        body: "{}"
      });
      assert.equal(logout.status, 200);
      const afterLogout = await fetch(baseUrl + "/api/providers", { headers: { cookie: first.cookie } });
      assert.equal(afterLogout.status, 401);
    } finally {
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[first.user.id, second.user.id]]);
      await new Promise(resolve => server.close(resolve));
      await pool.end();
    }
  });
}
