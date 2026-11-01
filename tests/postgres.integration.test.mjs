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

  const { app, pool, recoverRunningAgentTasks } = await import("../server.mjs");
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
    const migration = await readFile(new URL("../db/migrations/003_agent_runtime.sql", import.meta.url), "utf8");
    await pool.query(schema);
    await pool.query(migration);
    await pool.query(migration);
    server = app.listen(43127, "127.0.0.1");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });

    const suffix = randomUUID();
    const first = await register(`nexus-one-${suffix}@example.test`);
    const second = await register(`nexus-two-${suffix}@example.test`);

    try {
      const login = await fetch(baseUrl + "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ email: `nexus-one-${suffix}@example.test`, password: "Strong-test-password-123" })
      });
      assert.equal(login.status, 200);
      const loginBody = await login.json();
      assert.equal(loginBody.user.id, first.user.id);
      assert.ok(login.headers.get("set-cookie"), "login should issue a session cookie");

      const badLogin = await fetch(baseUrl + "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ email: `nexus-one-${suffix}@example.test`, password: "wrong-password-123" })
      });
      assert.equal(badLogin.status, 401);
      const memoryCreate = await fetch(baseUrl + "/api/memory", {
        method: "POST",
        headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
        body: JSON.stringify({ category: "preference", content: "Prefers concise technical explanations." })
      });
      assert.equal(memoryCreate.status, 201);
      const memoryBody = await memoryCreate.json();
      const firstMemories = await fetch(baseUrl + "/api/memory", { headers: { cookie: first.cookie } });
      assert.equal((await firstMemories.json()).memories.length, 1);
      const secondMemories = await fetch(baseUrl + "/api/memory", { headers: { cookie: second.cookie } });
      assert.equal((await secondMemories.json()).memories.length, 0, "memory must be private per user");
      const memoryUpdate = await fetch(baseUrl + `/api/memory/${memoryBody.memory.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
        body: JSON.stringify({ category: "note", content: "Updated memory note." })
      });
      assert.equal(memoryUpdate.status, 200);
      const foreignMemoryDelete = await fetch(baseUrl + `/api/memory/${memoryBody.memory.id}`, {
        method: "DELETE",
        headers: { origin, cookie: second.cookie, "x-csrf-token": second.csrf }
      });
      assert.equal(foreignMemoryDelete.status, 404, "users must not delete another user's memory");

      const taskCreate = await fetch(baseUrl + "/api/agent/tasks", {
        method: "POST",
        headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
        body: JSON.stringify({ title: "Integration task", prompt: "Prepare a safe project plan." })
      });
      assert.equal(taskCreate.status, 201);
      const taskBody = await taskCreate.json();
      assert.equal(taskBody.task.status, "queued");
      const taskDetails = await fetch(baseUrl + `/api/agent/tasks/${taskBody.task.id}`, { headers: { cookie: first.cookie } });
      const taskDetailsBody = await taskDetails.json();
      assert.equal(taskDetails.status, 200);
      assert.equal(taskDetailsBody.events[0].event_type, "task.created");
      const foreignTask = await fetch(baseUrl + `/api/agent/tasks/${taskBody.task.id}`, { headers: { cookie: second.cookie } });
      assert.equal(foreignTask.status, 404, "users must not inspect another user's task");
      const cancelTask = await fetch(baseUrl + `/api/agent/tasks/${taskBody.task.id}/cancel`, {
        method: "POST",
        headers: { origin, cookie: first.cookie, "x-csrf-token": first.csrf }
      });
      assert.equal(cancelTask.status, 200);
      assert.equal((await cancelTask.json()).task.status, "cancelled");
      const cancelAgain = await fetch(baseUrl + `/api/agent/tasks/${taskBody.task.id}/cancel`, {
        method: "POST",
        headers: { origin, cookie: first.cookie, "x-csrf-token": first.csrf }
      });
      assert.equal(cancelAgain.status, 409, "terminal tasks must not be cancelled again");

      const deleteMemory = await fetch(baseUrl + `/api/memory/${memoryBody.memory.id}`, {
        method: "DELETE",
        headers: { origin, cookie: first.cookie, "x-csrf-token": first.csrf }
      });
      assert.equal(deleteMemory.status, 200);

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
      const saveBodyText = await save.text();
      assert.equal(save.status, 200, saveBodyText);
      const savedBody = JSON.parse(saveBodyText);
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

      await pool.query(
        `INSERT INTO provider_credentials (user_id,provider,model_name,ciphertext,iv,auth_tag)
         SELECT $1,provider,model_name,ciphertext,iv,auth_tag FROM provider_credentials WHERE user_id=$2 AND provider='openai'`,
        [second.user.id, first.user.id]
      );
      const crossTenantDecrypt = await fetch(baseUrl + "/api/providers/openai/test", {
        method: "POST",
        headers: { "content-type": "application/json", origin, cookie: second.cookie, "x-csrf-token": second.csrf },
        body: "{}"
      });
      assert.equal(crossTenantDecrypt.status, 502, "encrypted key must be bound to its owning user and provider");
      await pool.query("DELETE FROM provider_credentials WHERE user_id=$1 AND provider='openai'", [second.user.id]);

      const otherList = await fetch(baseUrl + "/api/providers", { headers: { cookie: second.cookie } });
      assert.equal((await otherList.json()).providers.length, 0, "provider keys must be isolated per user");

      const select = await fetch(baseUrl + "/api/provider-selection", {
        method: "PUT",
        headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
        body: JSON.stringify({ provider: "openai" })
      });
      assert.equal(select.status, 200);
      assert.equal((await select.json()).activeProvider, "openai");
      const agentSeedMemory = await fetch(baseUrl + "/api/memory", {
        method: "POST",
        headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
        body: JSON.stringify({ category: "project", content: "Agent runtime seed memory for tool search." })
      });
      assert.equal(agentSeedMemory.status, 201);

      const originalFetch = globalThis.fetch;
      let capturedProviderRequest = null;
      globalThis.fetch = async (input, options = {}) => {
        if (String(input) === "https://api.openai.com/v1/chat/completions") {
          capturedProviderRequest = {
            authorization: options.headers?.Authorization,
            body: JSON.parse(options.body || "{}")
          };
          const lastMessage = capturedProviderRequest.body.messages?.at(-1)?.content || "";
          let content = "NEXUS connection successful";
          if (lastMessage.includes("NEXUS_AGENT_PLAN_JSON")) {
            if (lastMessage.includes("INVALID_TOOL_TEST")) {
              content = JSON.stringify({ steps: [{ title: "Unsafe step", description: "Should be rejected.", tool: "shell.exec", input: { command: "id" } }] });
            } else {
              content = JSON.stringify({ steps: [
                { title: "Search private memory", description: "Find relevant notes belonging to this user.", tool: "memory.search", input: { query: "Agent runtime seed" } },
                { title: "Save an approved note", description: "Persist a note only after the user approves the plan.", tool: "memory.save", input: { category: "note", content: "Approved agent memory artifact." } },
                { title: "Summarize the result", description: "Return a concise completion summary.", tool: "response.compose", input: { text: "Agent finished after approval." } }
              ] });
            }
          }
          return new Response(JSON.stringify({
            choices: [{ message: { role: "assistant", content } }]
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return originalFetch(input, options);
      };
      let chatConversationId;
      try {
        const providerTest = await originalFetch(baseUrl + "/api/providers/openai/test", {
          method: "POST",
          headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
          body: "{}"
        });
        assert.equal(providerTest.status, 200, await providerTest.text());
        assert.equal(capturedProviderRequest.authorization, `Bearer ${apiKey}`, "decrypted key must be sent only to the selected provider");
        assert.equal(capturedProviderRequest.body.messages.at(-1).content, "Reply with exactly: NEXUS connection successful");

        const firstChat = await originalFetch(baseUrl + "/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
          body: JSON.stringify({ message: "Remember this test phrase: blue comet." })
        });
        const firstChatText = await firstChat.text();
        assert.equal(firstChat.status, 200, firstChatText);
        const firstChatBody = JSON.parse(firstChatText);
        assert.equal(firstChatBody.answer, "NEXUS connection successful");
        chatConversationId = firstChatBody.conversationId;

        const secondChat = await originalFetch(baseUrl + "/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
          body: JSON.stringify({ message: "What phrase did I ask you to remember?", conversationId: chatConversationId })
        });
        assert.equal(secondChat.status, 200, await secondChat.text());
        assert.ok(capturedProviderRequest.body.messages.some(item => item.content.includes("blue comet.")), "chat history must be sent as provider context");

        const agentCreate = await originalFetch(baseUrl + "/api/agent/tasks", {
          method: "POST",
          headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
          body: JSON.stringify({ title: "Approved agent run", prompt: "Find my saved note, save an approved note and summarize." })
        });
        assert.equal(agentCreate.status, 201);
        const agentTaskId = (await agentCreate.json()).task.id;
        const agentPlan = await originalFetch(baseUrl + `/api/agent/tasks/${agentTaskId}/plan`, {
          method: "POST", headers: { origin, cookie: first.cookie, "x-csrf-token": first.csrf }
        });
        const agentPlanBody = await agentPlan.json();
        assert.equal(agentPlan.status, 200, JSON.stringify(agentPlanBody));
        assert.equal(agentPlanBody.task.status, "awaiting_approval");
        assert.equal(agentPlanBody.task.plan.steps.length, 3);
        assert.equal(agentPlanBody.task.plan.steps[1].requiresApproval, true, "memory writes must be marked approval-required");
        assert.ok(agentPlanBody.task.plan.steps.every(step => ["memory.search", "memory.save", "response.compose"].includes(step.tool)), "planner must only return allowlisted tools");
        const beforeApprovalMemory = await pool.query(
          "SELECT id FROM user_memories WHERE user_id=$1 AND content=$2",
          [first.user.id, "Approved agent memory artifact."]
        );
        assert.equal(beforeApprovalMemory.rowCount, 0, "planned writes must not execute before approval");
        const resumeWithoutApproval = await originalFetch(baseUrl + `/api/agent/tasks/${agentTaskId}/resume`, {
          method: "POST", headers: { origin, cookie: first.cookie, "x-csrf-token": first.csrf }
        });
        assert.equal(resumeWithoutApproval.status, 409, "resume cannot bypass the approval gate");

        const foreignApproval = await originalFetch(baseUrl + `/api/agent/tasks/${agentTaskId}/approve`, {
          method: "POST", headers: { origin, cookie: second.cookie, "x-csrf-token": second.csrf }
        });
        assert.equal(foreignApproval.status, 404, "another user cannot approve this task");

        const agentApprove = await originalFetch(baseUrl + `/api/agent/tasks/${agentTaskId}/approve`, {
          method: "POST", headers: { origin, cookie: first.cookie, "x-csrf-token": first.csrf }
        });
        assert.equal(agentApprove.status, 202);
        async function waitForAgentTask(id, expectedStatus) {
          for (let attempt = 0; attempt < 100; attempt += 1) {
            const response = await originalFetch(baseUrl + `/api/agent/tasks/${id}`, { headers: { cookie: first.cookie } });
            const body = await response.json();
            if (body.task?.status === expectedStatus) return body;
            if (["failed", "cancelled"].includes(body.task?.status) && body.task.status !== expectedStatus) {
              assert.fail(`Task entered unexpected terminal state: ${body.task.status}`);
            }
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          assert.fail(`Task did not reach ${expectedStatus} in time`);
        }
        const completedAgent = await waitForAgentTask(agentTaskId, "completed");
        assert.equal(completedAgent.task.current_step, 3);
        assert.equal(completedAgent.task.result, "Agent finished after approval.");
        assert.equal(completedAgent.task.plan.steps[0].result.memories.length, 1, "tool outputs must persist in the execution plan");
        assert.ok(completedAgent.events.some(event => event.event_type === "task.approved"));
        assert.equal(completedAgent.events.filter(event => event.event_type === "tool.executed").length, 3);
        const savedAgentMemory = await pool.query(
          "SELECT id FROM user_memories WHERE user_id=$1 AND content=$2",
          [first.user.id, "Approved agent memory artifact."]
        );
        assert.equal(savedAgentMemory.rowCount, 1, "approved memory.save tool should execute exactly once");

        const pausedCreate = await originalFetch(baseUrl + "/api/agent/tasks", {
          method: "POST",
          headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
          body: JSON.stringify({ title: "Pause and resume", prompt: "Prepare a resumable task plan." })
        });
        const pausedId = (await pausedCreate.json()).task.id;
        const pausedPlan = await originalFetch(baseUrl + `/api/agent/tasks/${pausedId}/plan`, {
          method: "POST", headers: { origin, cookie: first.cookie, "x-csrf-token": first.csrf }
        });
        assert.equal(pausedPlan.status, 200);
        await pool.query("UPDATE agent_tasks SET status='running',approved_at=now() WHERE id=$1 AND user_id=$2", [pausedId, first.user.id]);
        const pauseResponse = await originalFetch(baseUrl + `/api/agent/tasks/${pausedId}/pause`, {
          method: "POST", headers: { origin, cookie: first.cookie, "x-csrf-token": first.csrf }
        });
        assert.equal(pauseResponse.status, 200);
        assert.equal((await pauseResponse.json()).task.status, "paused");
        const resumeResponse = await originalFetch(baseUrl + `/api/agent/tasks/${pausedId}/resume`, {
          method: "POST", headers: { origin, cookie: first.cookie, "x-csrf-token": first.csrf }
        });
        assert.equal(resumeResponse.status, 202);
        const resumed = await waitForAgentTask(pausedId, "completed");
        assert.ok(resumed.events.some(event => event.event_type === "task.paused"));
        assert.ok(resumed.events.some(event => event.event_type === "task.resumed"));

        const recoveryCreate = await originalFetch(baseUrl + "/api/agent/tasks", {
          method: "POST",
          headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
          body: JSON.stringify({ title: "Restart recovery", prompt: "Prepare a task for restart recovery." })
        });
        const recoveryId = (await recoveryCreate.json()).task.id;
        const recoveryPlan = await originalFetch(baseUrl + `/api/agent/tasks/${recoveryId}/plan`, {
          method: "POST", headers: { origin, cookie: first.cookie, "x-csrf-token": first.csrf }
        });
        assert.equal(recoveryPlan.status, 200);
        await pool.query("UPDATE agent_tasks SET status='running',approved_at=now() WHERE id=$1 AND user_id=$2", [recoveryId, first.user.id]);
        assert.equal(await recoverRunningAgentTasks(), 1);
        const recoveredTask = await originalFetch(baseUrl + `/api/agent/tasks/${recoveryId}`, { headers: { cookie: first.cookie } });
        const recoveredBody = await recoveredTask.json();
        assert.equal(recoveredBody.task.status, "paused");
        assert.ok(recoveredBody.events.some(event => event.event_type === "task.recovered_paused"));

        const rejectedCreate = await originalFetch(baseUrl + "/api/agent/tasks", {
          method: "POST",
          headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
          body: JSON.stringify({ title: "Reject plan", prompt: "This plan will be rejected." })
        });
        const rejectedId = (await rejectedCreate.json()).task.id;
        const rejectedPlan = await originalFetch(baseUrl + `/api/agent/tasks/${rejectedId}/plan`, {
          method: "POST", headers: { origin, cookie: first.cookie, "x-csrf-token": first.csrf }
        });
        assert.equal(rejectedPlan.status, 200);
        const rejectResponse = await originalFetch(baseUrl + `/api/agent/tasks/${rejectedId}/reject`, {
          method: "POST", headers: { origin, cookie: first.cookie, "x-csrf-token": first.csrf }
        });
        assert.equal(rejectResponse.status, 200);
        assert.equal((await rejectResponse.json()).task.status, "cancelled");

        const invalidCreate = await originalFetch(baseUrl + "/api/agent/tasks", {
          method: "POST",
          headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
          body: JSON.stringify({ title: "Reject unsafe plan", prompt: "INVALID_TOOL_TEST" })
        });
        const invalidId = (await invalidCreate.json()).task.id;
        const invalidPlan = await originalFetch(baseUrl + `/api/agent/tasks/${invalidId}/plan`, {
          method: "POST", headers: { origin, cookie: first.cookie, "x-csrf-token": first.csrf }
        });
        assert.equal(invalidPlan.status, 502, "planner cannot request arbitrary tools");
        const invalidDetails = await originalFetch(baseUrl + `/api/agent/tasks/${invalidId}`, { headers: { cookie: first.cookie } });
        assert.equal((await invalidDetails.json()).task.status, "failed");
      } finally {
        globalThis.fetch = originalFetch;
      }

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
