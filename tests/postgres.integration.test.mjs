import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

if (!process.env.DATABASE_URL) {
  test("PostgreSQL integration suite requires DATABASE_URL", { skip: true }, () => {});
} else {
  process.env.NODE_ENV = "test";
  process.env.APP_ORIGIN = "http://127.0.0.1:43127";
  process.env.CREDENTIAL_ENCRYPTION_KEY = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";

  const { app, pool, runAgentTask } = await import("../server.mjs");
  const { startAgentWorker, claimNextAgentTask, releaseAgentTaskLease } = await import("../agent/worker-queue.mjs");
  const { processDueAgentSchedules } = await import("../agent/automation-scheduler.mjs");
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
    const stepLimitMigration = await readFile(new URL("../db/migrations/004_agent_step_limit.sql", import.meta.url), "utf8");
    const replanningMigration = await readFile(new URL("../db/migrations/005_agent_replanning.sql", import.meta.url), "utf8");
    const workerMigration = await readFile(new URL("../db/migrations/006_agent_worker_leases.sql", import.meta.url), "utf8");
    const taskFilesMigration = await readFile(new URL("../db/migrations/008_agent_task_files.sql", import.meta.url), "utf8");
    const agentProfileMigration = await readFile(new URL("../db/migrations/009_agent_profiles.sql", import.meta.url), "utf8");
    const agentDelegationMigration = await readFile(new URL("../db/migrations/010_agent_delegations.sql", import.meta.url), "utf8");
    const automationMigration = await readFile(new URL("../db/migrations/011_agent_automations_notifications.sql", import.meta.url), "utf8");
    await pool.query(schema);
    await pool.query(migration);
    await pool.query(migration);
    await pool.query(stepLimitMigration);
    await pool.query(stepLimitMigration);
    await pool.query(replanningMigration);
    await pool.query(replanningMigration);
    await pool.query(workerMigration);
    await pool.query(workerMigration);
    await pool.query(taskFilesMigration);
    await pool.query(taskFilesMigration);
    await pool.query(agentProfileMigration);
    await pool.query(agentProfileMigration);
    await pool.query(agentDelegationMigration);
    await pool.query(agentDelegationMigration);
    await pool.query(automationMigration);
    await pool.query(automationMigration);
    let worker = startAgentWorker({ pool, workerId: "integration-worker", pollIntervalMs: 10, leaseMs: 5_000, executeTask: (taskId, userId, leaseToken) => runAgentTask(taskId, userId, leaseToken), onError: error => console.error(error) });
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

      const workspaceBytes = Buffer.from("export const nexus = true;\\n");
      const workspaceBase64 = workspaceBytes.toString("base64");
      const taskCreate = await fetch(baseUrl + "/api/agent/tasks", {
        method: "POST",
        headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
        body: JSON.stringify({
          title: "Integration task", prompt: "Prepare a safe project plan.", agentProfile: "developer",
          files: [{ path: "src/index.js", contentBase64: workspaceBase64 }]
        })
      });
      assert.equal(taskCreate.status, 201);
      const taskBody = await taskCreate.json();
      assert.equal(taskBody.task.status, "queued");
      assert.equal(taskBody.task.agent_profile, "developer");
      assert.ok(taskBody.task.allowed_tools.includes("terminal.run"));
      assert.equal(taskBody.task.allowed_tools.includes("browser.open"), false);
      assert.deepEqual(taskBody.workspace, { fileCount: 1, totalBytes: workspaceBytes.length });
      const storedWorkspace = await pool.query(
        "SELECT ciphertext,iv,auth_tag,size_bytes FROM agent_task_files WHERE task_id=$1 AND user_id=$2",
        [taskBody.task.id, first.user.id]
      );
      assert.equal(storedWorkspace.rowCount, 1);
      assert.notEqual(storedWorkspace.rows[0].ciphertext, workspaceBase64, "workspace content must be encrypted at rest");
      assert.equal(storedWorkspace.rows[0].size_bytes, workspaceBytes.length);
      const workspaceList = await fetch(baseUrl + `/api/agent/tasks/${taskBody.task.id}/files`, { headers: { cookie: first.cookie } });
      const workspaceListBody = await workspaceList.json();
      assert.equal(workspaceList.status, 200);
      assert.equal(workspaceListBody.files.length, 1);
      assert.equal(workspaceListBody.files[0].path, "src/index.js");
      const workspaceDownload = await fetch(baseUrl + `/api/agent/tasks/${taskBody.task.id}/files/${workspaceListBody.files[0].id}`, { headers: { cookie: first.cookie } });
      const workspaceDownloadBody = await workspaceDownload.json();
      assert.equal(workspaceDownload.status, 200);
      assert.equal(workspaceDownloadBody.file.contentBase64, workspaceBase64);
      const foreignWorkspaceList = await fetch(baseUrl + `/api/agent/tasks/${taskBody.task.id}/files`, { headers: { cookie: second.cookie } });
      assert.equal(foreignWorkspaceList.status, 404, "workspace files must remain private to the task owner");
      const foreignWorkspaceDownload = await fetch(baseUrl + `/api/agent/tasks/${taskBody.task.id}/files/${workspaceListBody.files[0].id}`, { headers: { cookie: second.cookie } });
      assert.equal(foreignWorkspaceDownload.status, 404);
      const firstFilesLibrary = await fetch(baseUrl + "/api/files", { headers: { cookie: first.cookie } });
      assert.equal((await firstFilesLibrary.json()).files.length, 1);
      const secondFilesLibrary = await fetch(baseUrl + "/api/files", { headers: { cookie: second.cookie } });
      assert.equal((await secondFilesLibrary.json()).files.length, 0);
      const foreignWorkspaceDelete = await fetch(baseUrl + `/api/agent/tasks/${taskBody.task.id}/files/${workspaceListBody.files[0].id}`, {
        method: "DELETE",
        headers: { origin, cookie: second.cookie, "x-csrf-token": second.csrf }
      });
      assert.equal(foreignWorkspaceDelete.status, 404, "another user must not delete task files");
      const workspaceDelete = await fetch(baseUrl + `/api/agent/tasks/${taskBody.task.id}/files/${workspaceListBody.files[0].id}`, {
        method: "DELETE",
        headers: { origin, cookie: first.cookie, "x-csrf-token": first.csrf }
      });
      assert.equal(workspaceDelete.status, 200);
      const filesAfterDelete = await fetch(baseUrl + "/api/files", { headers: { cookie: first.cookie } });
      assert.equal((await filesAfterDelete.json()).files.length, 0);
      const workspaceEvents = await pool.query(
        "SELECT event_type,payload FROM agent_task_events WHERE task_id=$1 ORDER BY created_at ASC",
        [taskBody.task.id]
      );
      assert.ok(workspaceEvents.rows.some(event => event.event_type === "workspace.file_deleted"));
      const invalidWorkspaceUpload = await fetch(baseUrl + "/api/agent/tasks", {
        method: "POST",
        headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
        body: JSON.stringify({ title: "Invalid upload", prompt: "Reject traversal.", files: [{ path: "../secrets.txt", contentBase64: "eA==" }] })
      });
      assert.equal(invalidWorkspaceUpload.status, 400);
      const invalidAgentProfile = await fetch(baseUrl + "/api/agent/tasks", {
        method: "POST",
        headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
        body: JSON.stringify({ title: "Invalid specialist", prompt: "Reject unknown profile.", agentProfile: "unrestricted" })
      });
      assert.equal(invalidAgentProfile.status, 400);
      const agentProfiles = await fetch(baseUrl + "/api/agents", { headers: { cookie: first.cookie } });
      const profileBody = await agentProfiles.json();
      assert.equal(agentProfiles.status, 200);
      assert.deepEqual(profileBody.agents.map(agent => agent.id), ["general", "researcher", "developer", "reviewer"]);
      const privateProfiles = await fetch(baseUrl + "/api/agents");
      assert.equal(privateProfiles.status, 401);
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
          if (lastMessage.includes("NEXUS_AGENT_REPLAN_JSON")) {
            content = JSON.stringify({ steps: [
              { title: "Save the approved follow-up", description: "Persist the follow-up only after renewed approval.", tool: "memory.save", input: { category: "note", content: "Approved agent memory artifact." } },
              { title: "Summarize the updated evidence", description: "Summarize the search result and approved save.", tool: "response.compose", input: { text: "Agent finished after dynamic replanning." } }
            ] });
          } else if (lastMessage.includes("NEXUS_AGENT_PLAN_JSON")) {
            if (lastMessage.includes("RESEARCHER_SCOPE_VIOLATION_TEST")) {
              content = JSON.stringify({ steps: [
                { title: "Run a command", description: "Try to run a terminal command outside this profile scope.", tool: "terminal.run", input: { command: "id", files: [] }, replanAfter: true },
                { title: "Summarize", description: "Return the outcome.", tool: "response.compose", input: { text: "Reviewed." } }
              ] });
            } else if (lastMessage.includes("TERMINAL_RUN_VALID_TEST")) {
              content = JSON.stringify({ steps: [
                { title: "Run isolated command", description: "Run the requested command inside the no-network terminal sandbox.", tool: "terminal.run", input: { command: "printf 'NEXUS_TERMINAL_OK'", files: [] }, replanAfter: true },
                { title: "Summarize terminal result", description: "Summarize the bounded terminal output.", tool: "response.compose", input: { text: "Terminal command completed." } }
              ] });
            } else if (lastMessage.includes("TERMINAL_RUN_NO_REPLAN_TEST")) {
              content = JSON.stringify({ steps: [
                { title: "Run isolated command", description: "Run a terminal command.", tool: "terminal.run", input: { command: "id", files: [] } },
                { title: "Summarize terminal result", description: "Summarize the terminal output.", tool: "response.compose", input: { text: "Terminal command completed." } }
              ] });
            } else if (lastMessage.includes("BROWSER_OPEN_NO_REPLAN_TEST")) {
              content = JSON.stringify({ steps: [
                { title: "Inspect a public page", description: "Read a public page in the isolated browser.", tool: "browser.open", input: { url: "https://example.com/" } },
                { title: "Summarize the page", description: "Summarize the inspected page evidence.", tool: "response.compose", input: { text: "Page reviewed." } }
              ] });
            } else if (lastMessage.includes("BROWSER_OPEN_VALID_TEST")) {
              content = JSON.stringify({ steps: [
                { title: "Inspect a public page", description: "Read a public page in the isolated browser.", tool: "browser.open", input: { url: "https://example.com/" }, replanAfter: true },
                { title: "Summarize the page", description: "Summarize the inspected page evidence.", tool: "response.compose", input: { text: "Page reviewed." } }
              ] });
            } else if (lastMessage.includes("INVALID_TOOL_TEST")) {
              content = JSON.stringify({ steps: [{ title: "Unsafe step", description: "Should be rejected.", tool: "shell.exec", input: { command: "id" } }] });
            } else {
              const shouldReplan = lastMessage.includes("User task: Find my saved note");
              content = JSON.stringify({ steps: [
                { title: "Search private memory", description: "Find relevant notes belonging to this user.", tool: "memory.search", input: { query: "Agent runtime seed" }, replanAfter: shouldReplan },
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
          let lastStatus = "missing";
          for (let attempt = 0; attempt < 500; attempt += 1) {
            const response = await originalFetch(baseUrl + "/api/agent/tasks/" + id, { headers: { cookie: first.cookie } });
            const body = await response.json();
            lastStatus = body.task?.status || "missing";
            if (lastStatus === expectedStatus) return body;
            if (["failed", "cancelled"].includes(lastStatus) && lastStatus !== expectedStatus) {
              assert.fail("Task entered unexpected terminal state: " + lastStatus + " result=" + String(body.task?.result || ""));
            }
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          assert.fail("Task did not reach " + expectedStatus + " in time; last status=" + lastStatus + "; worker=" + JSON.stringify(worker?.health?.() || null));
        }
        const replannedAgent = await waitForAgentTask(agentTaskId, "awaiting_approval");
        assert.equal(replannedAgent.task.current_step, 1, "the first approved search step must remain completed");
        assert.equal(replannedAgent.task.replan_count, 1, "one evidence-driven replan should be recorded");
        assert.equal(replannedAgent.task.plan.steps.length, 3, "completed evidence plus continuation must remain within the plan");
        assert.equal(replannedAgent.task.plan.steps[0].status, "completed");
        assert.ok(replannedAgent.events.some(event => event.event_type === "task.replanned"));
        assert.ok(replannedAgent.events.some(event => event.event_type === "task.reapproval_required"));
        const beforeReapprovalMemory = await pool.query(
          "SELECT id FROM user_memories WHERE user_id=$1 AND content=$2",
          [first.user.id, "Approved agent memory artifact."]
        );
        assert.equal(beforeReapprovalMemory.rowCount, 0, "a newly proposed write must wait for renewed approval");
        const secondApproval = await originalFetch(baseUrl + `/api/agent/tasks/${agentTaskId}/approve`, {
          method: "POST", headers: { origin, cookie: first.cookie, "x-csrf-token": first.csrf }
        });
        assert.equal(secondApproval.status, 202, "the user must explicitly approve the replanned write");
        const completedAgent = await waitForAgentTask(agentTaskId, "completed");
        assert.equal(completedAgent.task.current_step, 3);
        assert.equal(completedAgent.task.replan_count, 1);
        assert.ok(completedAgent.task.result.startsWith("Agent finished after dynamic replanning."));
        assert.match(completedAgent.task.result, /Verified execution results/);
        assert.match(completedAgent.task.result, /memory.search/);
        assert.match(completedAgent.task.result, /memory.save/);
        assert.equal(completedAgent.task.plan.steps[0].result.memories.length, 1, "tool outputs must persist in the execution plan");
        assert.equal(completedAgent.events.filter(event => event.event_type === "task.approved").length, 2, "the continuation write must have a separate approval event");
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
        await worker.stop();
        await pool.query("UPDATE agent_tasks SET status='running',approved_at=now(),lease_owner='crashed-worker',lease_token=$1,lease_expires_at=now()-interval '1 second',worker_attempts=1 WHERE id=$2 AND user_id=$3", [randomUUID(), recoveryId, first.user.id]);
        const claims = await Promise.all([
          claimNextAgentTask(pool, "worker-a", 5_000),
          claimNextAgentTask(pool, "worker-b", 5_000)
        ]);
        assert.equal(claims.filter(Boolean).length, 1, "SKIP LOCKED lease claiming must prevent two workers owning one task");
        const claimed = claims.find(Boolean);
        assert.equal(claimed.worker_attempts, 2, "an expired lease must be reclaimed as a bounded retry");
        const replacementToken = randomUUID();
        await pool.query("UPDATE agent_tasks SET lease_owner='replacement-worker',lease_token=$1,lease_expires_at=now()+interval '30 seconds' WHERE id=$2", [replacementToken, recoveryId]);
        await runAgentTask(recoveryId, first.user.id, claimed.lease_token);
        const fenced = await pool.query("SELECT status,current_step FROM agent_tasks WHERE id=$1", [recoveryId]);
        assert.equal(fenced.rows[0].status, "running", "a stale worker must not execute after its fencing token is replaced");
        assert.equal(fenced.rows[0].current_step, 0, "a stale worker must not advance the execution cursor");
        await runAgentTask(recoveryId, first.user.id, replacementToken);
        const recoveredBody = await waitForAgentTask(recoveryId, "completed");
        assert.equal(recoveredBody.task.worker_attempts, 2);
        assert.ok(recoveredBody.events.some(event => event.event_type === "tool.executed"), "reclaimed work must continue from the persisted cursor");
        await releaseAgentTaskLease(pool, recoveryId, replacementToken);

        const heartbeatTask = await pool.query("INSERT INTO agent_tasks (user_id,title,prompt,status,approved_at,plan,current_step) VALUES ($1,'Heartbeat renewal','Long-running heartbeat test','running',now(),$2::jsonb,0) RETURNING id", [first.user.id, JSON.stringify({ steps: [] })]);
        let heartbeatExpiryBefore = 0;
        let heartbeatExpiryAfter = 0;
        const heartbeatWorker = startAgentWorker({
          pool, workerId: "heartbeat-integration-worker", pollIntervalMs: 10, leaseMs: 5_000,
          executeTask: async id => {
            const before = await pool.query("SELECT lease_expires_at FROM agent_tasks WHERE id=$1", [id]);
            heartbeatExpiryBefore = new Date(before.rows[0].lease_expires_at).getTime();
            await new Promise(resolve => setTimeout(resolve, 6_500));
            const after = await pool.query("SELECT lease_expires_at FROM agent_tasks WHERE id=$1", [id]);
            heartbeatExpiryAfter = new Date(after.rows[0].lease_expires_at).getTime();
          }
        });
        for (let attempt = 0; attempt < 100 && !heartbeatExpiryAfter; attempt += 1) await new Promise(resolve => setTimeout(resolve, 100));
        await heartbeatWorker.stop();
        const heartbeatHealth = heartbeatWorker.health();
        assert.ok(heartbeatExpiryBefore && heartbeatExpiryAfter > heartbeatExpiryBefore, "heartbeat must extend the lease during long-running work");
        assert.ok(heartbeatHealth.heartbeatSuccesses >= 2, "worker should record repeated successful heartbeats");
        assert.equal(heartbeatHealth.activeTaskId, null, "worker health must clear the active task after completion");

        await pool.query("UPDATE agent_tasks SET status='failed',result='Integration fixture cleanup' WHERE status='running'");
        const crashTask = await pool.query("INSERT INTO agent_tasks (user_id,title,prompt,status,approved_at,plan,current_step) VALUES ($1,'Process crash recovery','Hard termination test','running',now(),$2::jsonb,0) RETURNING id", [first.user.id, JSON.stringify({ steps: [] })]);
        const child = spawn(process.execPath, ["tests/fixtures/worker-hold.mjs"], {
          cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"]
        });
        let childOutput = "";
        child.stdout.on("data", chunk => { childOutput += chunk.toString(); });
        child.stderr.on("data", chunk => { childOutput += chunk.toString(); });
        let childClaimed = false;
        for (let attempt = 0; attempt < 200; attempt += 1) {
          const lease = await pool.query("SELECT lease_owner FROM agent_tasks WHERE id=$1", [crashTask.rows[0].id]);
          if (lease.rows[0]?.lease_owner === "hard-kill-worker") { childClaimed = true; break; }
          if (child.exitCode !== null) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (!childClaimed && child.exitCode === null && child.signalCode === null) {
          const failedChildExit = new Promise(resolve => child.once("exit", resolve));
          child.kill("SIGKILL");
          await failedChildExit;
        }
        assert.equal(childClaimed, true, "subprocess worker must claim the test task; exit=" + child.exitCode + " signal=" + child.signalCode + " output=" + childOutput);
        if (child.exitCode === null && child.signalCode === null) {
          const childExit = new Promise(resolve => child.once("exit", resolve));
          child.kill("SIGKILL");
          await childExit;
        }
        await new Promise(resolve => setTimeout(resolve, 5_200));
        const reclaimedAfterKill = await claimNextAgentTask(pool, "post-crash-recovery-worker", 5_000);
        assert.equal(reclaimedAfterKill?.id, crashTask.rows[0].id, "another worker must reclaim the task after a hard process kill");
        assert.equal(reclaimedAfterKill.worker_attempts, 2);
        await releaseAgentTaskLease(pool, crashTask.rows[0].id, reclaimedAfterKill.lease_token);
        await pool.query("UPDATE agent_tasks SET status='cancelled' WHERE id=$1", [crashTask.rows[0].id]);
        await pool.query("UPDATE agent_tasks SET status='completed' WHERE id=$1", [heartbeatTask.rows[0].id]);

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

        const browserCreate = await originalFetch(baseUrl + "/api/agent/tasks", {
          method: "POST",
          headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
          body: JSON.stringify({ title: "Inspect public page", prompt: "BROWSER_OPEN_VALID_TEST", agentProfile: "researcher" })
        });
        const browserId = (await browserCreate.json()).task.id;
        const browserPlan = await originalFetch(baseUrl + `/api/agent/tasks/${browserId}/plan`, {
          method: "POST", headers: { origin, cookie: first.cookie, "x-csrf-token": first.csrf }
        });
        const browserPlanBody = await browserPlan.json();
        assert.equal(browserPlan.status, 200, JSON.stringify(browserPlanBody));
        assert.equal(browserPlanBody.task.agent_profile, "researcher");
        assert.equal(browserPlanBody.task.allowed_tools.includes("terminal.run"), false);
        assert.equal(browserPlanBody.task.plan.steps[0].tool, "browser.open");
        assert.equal(browserPlanBody.task.plan.steps[0].requiresApproval, true);
        assert.equal(browserPlanBody.task.plan.steps[0].replanAfter, true);

        const researcherScopeCreate = await originalFetch(baseUrl + "/api/agent/tasks", {
          method: "POST",
          headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
          body: JSON.stringify({ title: "Reject out of scope tool", prompt: "RESEARCHER_SCOPE_VIOLATION_TEST", agentProfile: "researcher" })
        });
        const researcherScopeId = (await researcherScopeCreate.json()).task.id;
        const researcherScopePlan = await originalFetch(baseUrl + `/api/agent/tasks/${researcherScopeId}/plan`, {
          method: "POST", headers: { origin, cookie: first.cookie, "x-csrf-token": first.csrf }
        });
        assert.equal(researcherScopePlan.status, 502, "researcher profile must not gain terminal permissions");
        const researcherScopeState = await pool.query("SELECT status,agent_profile FROM agent_tasks WHERE id=$1", [researcherScopeId]);
        assert.equal(researcherScopeState.rows[0].status, "failed");
        assert.equal(researcherScopeState.rows[0].agent_profile, "researcher");

        const browserNoReplanCreate = await originalFetch(baseUrl + "/api/agent/tasks", {
          method: "POST",
          headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
          body: JSON.stringify({ title: "Reject unsafe browser plan", prompt: "BROWSER_OPEN_NO_REPLAN_TEST" })
        });
        const browserNoReplanId = (await browserNoReplanCreate.json()).task.id;
        const browserNoReplan = await originalFetch(baseUrl + `/api/agent/tasks/${browserNoReplanId}/plan`, {
          method: "POST", headers: { origin, cookie: first.cookie, "x-csrf-token": first.csrf }
        });
        assert.equal(browserNoReplan.status, 502, "browser output must flow through evidence-driven replanning");

        const terminalCreate = await originalFetch(baseUrl + "/api/agent/tasks", {
          method: "POST",
          headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
          body: JSON.stringify({ title: "Run in terminal sandbox", prompt: "TERMINAL_RUN_VALID_TEST", agentProfile: "developer" })
        });
        const terminalId = (await terminalCreate.json()).task.id;
        const terminalPlan = await originalFetch(baseUrl + `/api/agent/tasks/${terminalId}/plan`, {
          method: "POST", headers: { origin, cookie: first.cookie, "x-csrf-token": first.csrf }
        });
        const terminalPlanBody = await terminalPlan.json();
        assert.equal(terminalPlan.status, 200, JSON.stringify(terminalPlanBody));
        assert.equal(terminalPlanBody.task.status, "awaiting_approval");
        assert.equal(terminalPlanBody.task.agent_profile, "developer");
        assert.equal(terminalPlanBody.task.allowed_tools.includes("browser.open"), false);
        assert.equal(terminalPlanBody.task.plan.steps[0].tool, "terminal.run");
        assert.equal(terminalPlanBody.task.plan.steps[0].requiresApproval, true);
        assert.equal(terminalPlanBody.task.plan.steps[0].replanAfter, true);

        const terminalNoReplanCreate = await originalFetch(baseUrl + "/api/agent/tasks", {
          method: "POST",
          headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
          body: JSON.stringify({ title: "Reject unsafe terminal plan", prompt: "TERMINAL_RUN_NO_REPLAN_TEST" })
        });
        const terminalNoReplanId = (await terminalNoReplanCreate.json()).task.id;
        const terminalNoReplan = await originalFetch(baseUrl + `/api/agent/tasks/${terminalNoReplanId}/plan`, {
          method: "POST", headers: { origin, cookie: first.cookie, "x-csrf-token": first.csrf }
        });
        assert.equal(terminalNoReplan.status, 502, "terminal output must flow through evidence-driven replanning");

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

      const runAt = new Date(Date.now() - 30_000);
      const oneShot = await pool.query(
        "INSERT INTO agent_schedules (user_id,title,prompt,agent_profile,timezone,next_run_at) VALUES ($1,$2,$3,'researcher','Asia/Kolkata',$4) RETURNING id",
        [first.user.id, "Daily public research", "Summarize the latest saved research topic.", runAt]
      );
      const scheduledTasks = await processDueAgentSchedules(pool, { now: new Date(), batchSize: 10 });
      assert.equal(scheduledTasks.length, 1, "a due one-shot schedule should enqueue exactly one task");
      assert.equal(scheduledTasks[0].scheduleId, oneShot.rows[0].id);
      const duplicateSchedulePass = await processDueAgentSchedules(pool, { now: new Date(), batchSize: 10 });
      assert.equal(duplicateSchedulePass.length, 0, "a one-shot schedule must not enqueue twice");
      const oneShotState = await pool.query(
        "SELECT enabled,last_run_at FROM agent_schedules WHERE id=$1 AND user_id=$2",
        [oneShot.rows[0].id, first.user.id]
      );
      assert.equal(oneShotState.rows[0].enabled, false);
      assert.ok(oneShotState.rows[0].last_run_at);
      const scheduleRun = await pool.query(
        "SELECT id,task_id,status FROM agent_schedule_runs WHERE schedule_id=$1 AND user_id=$2",
        [oneShot.rows[0].id, first.user.id]
      );
      assert.equal(scheduleRun.rowCount, 1);
      assert.equal(scheduleRun.rows[0].task_id, scheduledTasks[0].taskId);

      const inbox = await fetch(baseUrl + "/api/notifications", { headers: { cookie: first.cookie } });
      const inboxBody = await inbox.json();
      assert.equal(inbox.status, 200, JSON.stringify(inboxBody));
      const scheduleNotification = inboxBody.notifications.find(item => item.schedule_id === oneShot.rows[0].id);
      assert.ok(scheduleNotification, "scheduled workflow should create a private inbox notification");
      const foreignInbox = await fetch(baseUrl + "/api/notifications", { headers: { cookie: second.cookie } });
      assert.equal((await foreignInbox.json()).notifications.length, 0, "notifications must be scoped to their owner");
      const markRead = await fetch(baseUrl + `/api/notifications/${scheduleNotification.id}/read`, {
        method: "POST",
        headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
        body: "{}"
      });
      assert.equal(markRead.status, 200);
      const readCheck = await pool.query("SELECT read_at FROM user_notifications WHERE id=$1 AND user_id=$2", [scheduleNotification.id, first.user.id]);
      assert.ok(readCheck.rows[0].read_at, "notification read state should persist");

      const recurringAt = new Date(Date.now() - 30_000);
      const recurring = await pool.query(
        "INSERT INTO agent_schedules (user_id,title,prompt,agent_profile,interval_minutes,timezone,next_run_at) VALUES ($1,$2,$3,'general',15,'Asia/Kolkata',$4) RETURNING id",
        [first.user.id, "Project status check", "Review the current project status.", recurringAt]
      );
      const recurringTasks = await processDueAgentSchedules(pool, { now: new Date(), batchSize: 10 });
      assert.equal(recurringTasks.length, 1);
      const recurringState = await pool.query(
        "SELECT enabled,next_run_at,last_run_at FROM agent_schedules WHERE id=$1 AND user_id=$2",
        [recurring.rows[0].id, first.user.id]
      );
      assert.equal(recurringState.rows[0].enabled, true);
      assert.ok(new Date(recurringState.rows[0].next_run_at).getTime() > Date.now());
      assert.ok(recurringState.rows[0].last_run_at);

      const apiScheduled = await fetch(baseUrl + "/api/agent/schedules", {
        method: "POST",
        headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
        body: JSON.stringify({
          title: "Weekly review",
          prompt: "Prepare a weekly review.",
          agentProfile: "reviewer",
          timezone: "Asia/Kolkata",
          runAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          intervalMinutes: 10080
        })
      });
      const apiScheduledBody = await apiScheduled.json();
      assert.equal(apiScheduled.status, 201, JSON.stringify(apiScheduledBody));
      const listSchedules = await fetch(baseUrl + "/api/agent/schedules", { headers: { cookie: first.cookie } });
      assert.equal(listSchedules.status, 200);
      assert.ok((await listSchedules.json()).schedules.some(item => item.id === apiScheduledBody.schedule.id));
      const pauseSchedule = await fetch(baseUrl + `/api/agent/schedules/${apiScheduledBody.schedule.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
        body: JSON.stringify({ enabled: false })
      });
      assert.equal(pauseSchedule.status, 200);
      const resumeSchedule = await fetch(baseUrl + `/api/agent/schedules/${apiScheduledBody.schedule.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json", origin, cookie: first.cookie, "x-csrf-token": first.csrf },
        body: JSON.stringify({ enabled: true })
      });
      assert.equal(resumeSchedule.status, 200);
      const scheduleDelete = await fetch(baseUrl + `/api/agent/schedules/${apiScheduledBody.schedule.id}`, {
        method: "DELETE",
        headers: { origin, cookie: first.cookie, "x-csrf-token": first.csrf }
      });
      assert.equal(scheduleDelete.status, 200);

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
      await worker.stop();
      await new Promise(resolve => server.close(resolve));
      await pool.end();
    }
  });
}
