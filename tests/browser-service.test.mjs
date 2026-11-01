import { test } from "node:test";
import assert from "node:assert/strict";
import { createBrowserWorkerServer } from "../computer/browser-service.mjs";

const userId = "8c6e7cb2-8c3a-4c3b-9f52-0c9f8b4d0a12";
const token = "test-browser-worker-token-which-is-at-least-32-bytes";

function fakeChromium() {
  const state = { launches: 0, browserClosed: 0, contextClosed: 0, route: null };
  const chromium = {
    async launch(options) {
      state.launches += 1;
      assert.equal(options.headless, true);
      assert.equal(options.proxy.server, "http://egress-proxy:3128");
      return {
        async newContext(options) {
          assert.equal(options.acceptDownloads, false);
          assert.equal(options.serviceWorkers, "block");
          return {
            async route(_pattern, handler) { state.route = handler; },
            async routeWebSocket(_pattern, handler) { state.websocketHandler = handler; },
            on() {},
            async newPage() {
              return {
                on() {},
                async goto(url) {
                  let continued = false;
                  await state.route({
                    request: () => ({ url: () => url, method: () => "GET" }),
                    continue: async () => { continued = true; },
                    abort: async () => { continued = false; }
                  });
                  if (!continued) throw new Error("blocked route");
                  this.currentUrl = url;
                  return { status: () => 200, headers: () => ({}) };
                },
                url() { return this.currentUrl; },
                async title() { return "Safe test page"; },
                locator() { return { innerText: async () => "Public page text" }; }
              };
            },
            async close() { state.contextClosed += 1; }
          };
        },
        async close() { state.browserClosed += 1; }
      };
    }
  };
  return { chromium, state };
}

async function withServer(run, options = {}) {
  const fake = fakeChromium();
  const server = createBrowserWorkerServer({
    chromium: fake.chromium,
    token,
    egressProxy: "http://egress-proxy:3128",
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    ...options
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try { await run(`http://127.0.0.1:${address.port}`, fake.state); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("browser worker health is private and does not expose configuration", async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, state: "idle" });
  });
});

test("browser worker rejects missing bearer token without launching a browser", async () => {
  await withServer(async (base, state) => {
    const response = await fetch(`${base}/execute`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, url: "https://example.com" })
    });
    assert.equal(response.status, 401);
    assert.equal(state.launches, 0);
  });
});

test("browser worker executes a bounded read-only page job and always closes resources", async () => {
  await withServer(async (base, state) => {
    const response = await fetch(`${base}/execute`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ userId, url: "https://example.com" })
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.result, {
      url: "https://example.com/",
      title: "Safe test page",
      status: 200,
      text: "Public page text",
      requestCount: 1
    });
    assert.equal(state.launches, 1);
    assert.equal(state.contextClosed, 1);
    assert.equal(state.browserClosed, 1);
  });
});

test("browser worker rejects localhost destinations before browser launch", async () => {
  await withServer(async (base, state) => {
    const response = await fetch(`${base}/execute`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ userId, url: "http://127.0.0.1:4000/health" })
    });
    assert.equal(response.status, 400);
    assert.equal(state.launches, 0);
  });
});

test("browser worker requires a strong token and an explicit egress proxy", () => {
  const chromium = fakeChromium().chromium;
  assert.throws(() => createBrowserWorkerServer({ chromium, token: "short", egressProxy: "http://proxy:3128" }), /32 bytes/);
  assert.throws(() => createBrowserWorkerServer({ chromium, token, egressProxy: "" }), /BROWSER_EGRESS_PROXY/);
});


test("browser worker enforces a six-job per-user rolling-window quota", async () => {
  await withServer(async (base, state) => {
    for (let index = 0; index < 6; index += 1) {
      const response = await fetch(`${base}/execute`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ userId, url: "https://example.com" })
      });
      assert.equal(response.status, 200);
    }
    const limited = await fetch(`${base}/execute`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ userId, url: "https://example.com" })
    });
    assert.equal(limited.status, 429);
    assert.equal(state.launches, 6);
  });
});

test("browser worker rejects oversized and unexpected job payloads", async () => {
  await withServer(async base => {
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const oversized = await fetch(`${base}/execute`, {
      method: "POST", headers, body: JSON.stringify({ userId, url: "https://" + "a".repeat(17_000) + ".com" })
    });
    assert.equal(oversized.status, 400);
    const extraField = await fetch(`${base}/execute`, {
      method: "POST", headers,
      body: JSON.stringify({ userId, url: "https://example.com", command: "whoami" })
    });
    assert.equal(extraField.status, 400);
  });
});
