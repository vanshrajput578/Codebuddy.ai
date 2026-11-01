import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { validateBrowserTarget } from "./browser-policy.mjs";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_NAVIGATION_MS = 12_000;
const MAX_PAGE_TEXT = 12_000;
const MAX_PAGE_REQUESTS = 40;
const USER_WINDOW_MS = 60_000;
const USER_REQUEST_LIMIT = 6;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

async function readJson(request) {
  const declared = Number(request.headers["content-length"] || 0);
  if (declared > MAX_BODY_BYTES) throw new Error("Request body is too large.");
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("Request body must be valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be an object.");
  if (Object.keys(value).some(key => !["userId", "url"].includes(key))) throw new Error("Unsupported browser job fields.");
  if (typeof value.userId !== "string" || !UUID_PATTERN.test(value.userId)) throw new Error("A valid user ID is required.");
  return { userId: value.userId, url: value.url };
}

function proxyConfig(proxyValue) {
  let proxyUrl;
  try { proxyUrl = new URL(proxyValue); }
  catch { throw new Error("BROWSER_EGRESS_PROXY must be a valid proxy URL."); }
  if (!["http:", "https:", "socks5:"].includes(proxyUrl.protocol) || !proxyUrl.hostname) {
    throw new Error("BROWSER_EGRESS_PROXY must use HTTP, HTTPS or SOCKS5.");
  }
  const result = { server: proxyUrl.origin };
  if (proxyUrl.username) result.username = decodeURIComponent(proxyUrl.username);
  if (proxyUrl.password) result.password = decodeURIComponent(proxyUrl.password);
  return result;
}

async function executeReadOnlyPage({ chromium, proxy, url, lookup }) {
  const browser = await chromium.launch({ headless: true, proxy });
  let context;
  try {
    context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      ignoreHTTPSErrors: false
    });
    const page = await context.newPage();
    let requestCount = 0;
    let mainPage = page;

    await context.route("**/*", async route => {
      const request = route.request();
      requestCount += 1;
      if (requestCount > MAX_PAGE_REQUESTS || !["GET", "HEAD"].includes(request.method().toUpperCase())) {
        await route.abort("blockedbyclient").catch(() => {});
        return;
      }
      try {
        await validateBrowserTarget(request.url(), { lookup });
        await route.continue();
      } catch {
        await route.abort("blockedbyclient").catch(() => {});
      }
    });

    if (typeof context.routeWebSocket === "function") {
      await context.routeWebSocket("**/*", socket => socket.close());
    }
    context.on("page", opened => {
      if (opened !== mainPage) void opened.close().catch(() => {});
    });
    page.on("popup", opened => void opened.close().catch(() => {}));
    page.on("download", download => void download.cancel().catch(() => {}));

    let response;
    try {
      response = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: MAX_NAVIGATION_MS });
    } catch {
      throw new Error("Browser navigation was blocked or timed out.");
    }
    await validateBrowserTarget(page.url(), { lookup });
    const headers = response?.headers?.() || {};
    if (/attachment/i.test(headers["content-disposition"] || "")) throw new Error("File downloads are not allowed.");
    let text = "";
    try { text = await page.locator("body").innerText({ timeout: 2_000 }); } catch {}
    return {
      url: page.url(),
      title: String(await page.title().catch(() => "")).slice(0, 300),
      status: response?.status?.() ?? null,
      text: String(text).replace(/\u0000/g, "").slice(0, MAX_PAGE_TEXT),
      requestCount
    };
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

export function createBrowserWorkerServer({
  chromium,
  token,
  egressProxy,
  host = "127.0.0.1",
  port = 4002,
  lookup
}) {
  if (!chromium || typeof chromium.launch !== "function") throw new Error("A Chromium Playwright driver is required.");
  if (typeof token !== "string" || Buffer.byteLength(token) < 32) throw new Error("BROWSER_WORKER_TOKEN must contain at least 32 bytes.");
  if (typeof egressProxy !== "string" || !egressProxy.trim()) throw new Error("BROWSER_EGRESS_PROXY is required; direct browser egress is disabled.");
  const proxy = proxyConfig(egressProxy);
  let active = false;
  const userWindows = new Map();

  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      return sendJson(response, 200, { ok: true, state: active ? "busy" : "idle" });
    }
    if (request.method !== "POST" || request.url !== "/execute") return sendJson(response, 404, { error: "Not found." });
    if (!safeEqual(request.headers.authorization || "", `Bearer ${token}`)) return sendJson(response, 401, { error: "Unauthorized." });

    let job;
    try { job = await readJson(request); }
    catch (error) { return sendJson(response, 400, { error: error.message }); }
    if (active) return sendJson(response, 429, { error: "Browser worker is busy; retry shortly." });

    const now = Date.now();
    const window = userWindows.get(job.userId);
    if (!window || now - window.startedAt >= USER_WINDOW_MS) {
      userWindows.set(job.userId, { startedAt: now, count: 1 });
    } else if (window.count >= USER_REQUEST_LIMIT) {
      return sendJson(response, 429, { error: "Browser request quota exceeded. Try again later." });
    } else {
      window.count += 1;
    }
    for (const [userId, value] of userWindows) {
      if (now - value.startedAt >= USER_WINDOW_MS) userWindows.delete(userId);
    }

    active = true;
    try {
      const target = await validateBrowserTarget(job.url, { lookup });
      const result = await executeReadOnlyPage({ chromium, proxy, url: target, lookup });
      return sendJson(response, 200, { result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Browser request failed.";
      const status = /valid HTTP|Only HTTP|credentials|ports|hostname|IP address|resolves|resolved|address/i.test(message) ? 400 : 502;
      return sendJson(response, status, { error: message.slice(0, 240) });
    } finally {
      active = false;
    }
  });

  server.requestTimeout = 20_000;
  server.headersTimeout = 5_000;
  server.maxHeadersCount = 32;
  return server;
}
