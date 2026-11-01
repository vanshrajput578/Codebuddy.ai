import { test } from "node:test";
import assert from "node:assert/strict";
import { createTerminalWorkerServer } from "../computer/terminal-service.mjs";

const token = "terminal-worker-token-with-at-least-thirty-two-bytes";
const userId = "8c6e7cb2-8c3a-4c3b-9f52-0c9f8b4d0a12";

async function withServer(run, options = {}) {
  const calls = [];
  const server = createTerminalWorkerServer({
    token,
    runSandbox: async job => {
      calls.push(job);
      return { exitCode: 0, stdout: "ok", stderr: "", timedOut: false, outputTruncated: false, files: [], warnings: [], totalBytes: 0 };
    },
    ...options
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`, calls); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("terminal worker health exposes only idle or busy state", async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, state: "idle" });
  });
});

test("terminal worker requires its internal bearer token", async () => {
  await withServer(async (base, calls) => {
    const response = await fetch(`${base}/execute`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, command: "id", files: [] })
    });
    assert.equal(response.status, 401);
    assert.equal(calls.length, 0);
  });
});

test("terminal worker validates tenant, command and files before sandbox launch", async () => {
  await withServer(async (base, calls) => {
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const traversal = await fetch(`${base}/execute`, {
      method: "POST", headers,
      body: JSON.stringify({ userId, command: "cat ../secret", files: [{ path: "../secret", contentBase64: "eA==" }] })
    });
    assert.equal(traversal.status, 400);
    const badCommand = await fetch(`${base}/execute`, {
      method: "POST", headers,
      body: JSON.stringify({ userId, command: " ", files: [] })
    });
    assert.equal(badCommand.status, 400);
    assert.equal(calls.length, 0);
  });
});

test("terminal worker returns bounded sandbox output", async () => {
  await withServer(async (base, calls) => {
    const response = await fetch(`${base}/execute`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ userId, command: "pwd && ls", files: [{ path: "README.md", contentBase64: Buffer.from("hello").toString("base64") }] })
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.result.stdout, "ok");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].files[0].path, "README.md");
    assert.equal(Buffer.from(calls[0].files[0].contentBase64, "base64").toString(), "hello");
  });
});

test("terminal worker enforces per-user quota and global concurrency", async () => {
  let release;
  await withServer(async (base, calls) => {
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    release = null;
    const hold = new Promise(resolve => { release = resolve; });
    const slowServer = createTerminalWorkerServer({
      token,
      runSandbox: async job => {
        calls.push(job);
        await hold;
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false, outputTruncated: false, files: [], warnings: [], totalBytes: 0 };
      }
    });
    await new Promise(resolve => slowServer.listen(0, "127.0.0.1", resolve));
    const slowBase = `http://127.0.0.1:${slowServer.address().port}`;
    try {
      const body = JSON.stringify({ userId, command: "true", files: [] });
      const running = fetch(`${slowBase}/execute`, { method: "POST", headers, body });
      await new Promise(resolve => setTimeout(resolve, 15));
      const busy = await fetch(`${slowBase}/execute`, { method: "POST", headers, body });
      assert.equal(busy.status, 429);
      release();
      assert.equal((await running).status, 200);
    } finally {
      if (release) release();
      await new Promise(resolve => slowServer.close(resolve));
    }
  });
});
