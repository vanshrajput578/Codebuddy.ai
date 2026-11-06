import { getProviderCapabilities, extractSseData } from "./provider-capabilities.mjs";

// One request timeout per attempt, not one shared across the whole call.
// The old code created a single AbortSignal.timeout(60_000) before the
// retry loop, so a slow first attempt ate the second attempt's budget and
// a fetch that timed out was never retried at all. Gemini's CI failure
// ("The operation was aborted due to timeout") is exactly that shape:
// one slow attempt, no retry, and a bare abort message with no provider
// or cause attached.
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 2;

function messagesFor(history, prompt) {
  return [...history.map(item => ({
    role: item.role === "model" ? "assistant" : "user",
    content: item.parts?.map(part => part.text || "").join("") || ""
  })), { role: "user", content: prompt }];
}

function sanitizeDetail(detail, key) {
  let text = String(detail || "");
  // Redact the exact credential that was sent, whatever shape it has.
  // The old pattern-only redaction missed any echoed value that did not
  // look like sk-/AIza, which is how a provider echoing a key back in an
  // error message could leak it into logs. split/join avoids regex
  // escaping issues with arbitrary key characters.
  if (key && key.length >= 8) text = text.split(key).join("[redacted]");
  text = text
    .replace(/Bearer\s+\S+/gi, "[redacted]")
    .replace(/(?:sk-or-v1-|sk-ant-|sk-|AIza)[A-Za-z0-9_-]{12,}/g, "[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 240)
    .replace(/[. ]+$/, "");
  return text;
}

function isTimeoutError(error) {
  return error?.name === "TimeoutError" || error?.name === "AbortError";
}

function isUserCancelled(signal) {
  return Boolean(signal?.aborted);
}

function classifyHttpStatus(status, detail) {
  if (status === 401 || status === 403) return "authentication failed; check the API key";
  if (status === 404) return "model not found or no access to the model";
  if (status === 429) return "rate limited; retry later";
  if (status === 408 || (status >= 500 && status <= 599)) return "transient provider error; retry later";
  if (status === 400 && /credit balance|insufficient|billing/i.test(detail || "")) {
    return "credits/billing: the provider reports insufficient credits; top up billing or use a funded key";
  }
  if (status === 400) return "bad request; check the API key and model";
  return "";
}

function timeoutMessage(provider, model, attempts) {
  return `[${provider}] Provider request timed out after ${REQUEST_TIMEOUT_MS / 1000}s (${attempts} attempt${attempts === 1 ? "" : "s"}, model ${model}). ` +
    "The provider did not respond in time; check the API key, model access and quota, then retry.";
}

async function* readSse(response, extract, signal, context) {
  const { provider, model, key } = context;
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    let detail = "";
    try {
      const payload = JSON.parse(raw);
      detail = payload?.error?.message || payload?.message || payload?.error?.status || payload?.error?.type || "";
    } catch {}
    detail = sanitizeDetail(detail, key);
    const category = classifyHttpStatus(response.status, detail);
    throw new Error(`[${provider}] Provider request failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}.${category ? ` ${category}.` : ""}`);
  }
  if (!response.body) throw new Error(`[${provider}] Provider returned no stream (model ${model}).`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) {
        if (isUserCancelled(context.userSignal)) throw new Error("Stream cancelled.");
        throw new Error(timeoutMessage(provider, model, MAX_ATTEMPTS));
      }
      let readResult;
      try {
        readResult = await reader.read();
      } catch (error) {
        if (isUserCancelled(context.userSignal)) throw new Error("Stream cancelled.");
        if (isTimeoutError(error)) throw new Error(timeoutMessage(provider, model, MAX_ATTEMPTS));
        throw new Error(`[${provider}] Provider stream failed: ${sanitizeDetail(error?.message || "stream read failed", key)} (model ${model}).`);
      }
      const { value, done } = readResult;
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary).replace(/\r/g, "");
        buffer = buffer.slice(boundary + 2);
        const data = extractSseData(frame);
        const delta = data && extract(data);
        if (typeof delta === "string" && delta) yield delta;
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const data = extractSseData(buffer);
      const delta = data && extract(data);
      if (typeof delta === "string" && delta) yield delta;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* streamProviderResponse(provider, key, model, prompt, history = [], options = {}) {
  const { signal } = options;
  const capability = getProviderCapabilities(provider, model);
  model = capability.model;
  let endpoint, headers, body, extract;
  const messages = messagesFor(history, prompt);
  if (provider === "gemini") {
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    headers = { "Content-Type": "application/json", "x-goog-api-key": key };
    body = { contents: [...history, { role: "user", parts: [{ text: prompt }] }] };
    extract = data => data.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("") || "";
  } else if (provider === "openai" || provider === "openrouter") {
    endpoint = provider === "openai" ? "https://api.openai.com/v1/chat/completions" : "https://openrouter.ai/api/v1/chat/completions";
    headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
    if (provider === "openrouter") { headers["HTTP-Referer"] = process.env.APP_ORIGIN || "http://localhost"; headers["X-Title"] = "NEXUS AI"; }
    body = { model, messages, stream: true, stream_options: { include_usage: true } };
    extract = data => data.choices?.[0]?.delta?.content || "";
  } else if (provider === "anthropic") {
    endpoint = "https://api.anthropic.com/v1/messages";
    headers = { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" };
    body = { model, max_tokens: 4096, messages, stream: true };
    extract = data => data.type === "content_block_delta" && data.delta?.type === "text_delta" ? data.delta.text : "";
  } else throw new Error("Unsupported provider.");

  const context = { provider, model, key, userSignal: signal };
  let response;
  let attempts = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    attempts = attempt + 1;
    // Fresh timeout per attempt: a slow first attempt must not steal
    // the retry's budget.
    const attemptTimeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([signal, attemptTimeout]) : attemptTimeout;
    try {
      response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: requestSignal });
    } catch (error) {
      if (isUserCancelled(signal)) throw new Error("Stream cancelled.");
      // Timeouts and network failures are retryable once. Previously a
      // fetch timeout threw straight out, so Gemini got exactly one
      // 60-second chance and the whole CI step failed on it.
      if (isTimeoutError(error) || error?.name === "TypeError") {
        if (attempt < MAX_ATTEMPTS - 1) {
          await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
          continue;
        }
        if (isTimeoutError(error)) throw new Error(timeoutMessage(provider, model, attempts));
        throw new Error(`[${provider}] Provider request failed: ${sanitizeDetail(error?.message || "network error", key)} (model ${model}).`);
      }
      throw new Error(`[${provider}] Provider request failed: ${sanitizeDetail(error?.message || "request failed", key)} (model ${model}).`);
    }
    if (response.ok || ![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === MAX_ATTEMPTS - 1) break;
    await response.body?.cancel().catch(() => {});
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 250 * (attempt + 1));
      requestSignal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(isUserCancelled(signal) ? new Error("Stream cancelled.") : new Error(timeoutMessage(provider, model, attempts)));
      }, { once: true });
    });
  }
  if (!response) throw new Error(timeoutMessage(provider, model, attempts));
  // Fresh timeout for the streaming phase: the fetch budget is spent
  // once headers arrive, a slow stream must not inherit its remainder.
  const streamTimeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const streamSignal = signal ? AbortSignal.any([signal, streamTimeout]) : streamTimeout;
  yield* readSse(response, extract, streamSignal, context);
}
