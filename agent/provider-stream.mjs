import { getProviderCapabilities, extractSseData } from "./provider-capabilities.mjs";

function messagesFor(history, prompt) {
  return [...history.map(item => ({
    role: item.role === "model" ? "assistant" : "user",
    content: item.parts?.map(part => part.text || "").join("") || ""
  })), { role: "user", content: prompt }];
}

async function* readSse(response, extract, signal) {
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    let detail = "";
    try {
      const payload = JSON.parse(raw);
      detail = payload?.error?.message || payload?.message || payload?.error?.status || payload?.error?.type || "";
    } catch {}
    detail = String(detail)
      .replace(/Bearer\s+\S+/gi, "[redacted]")
      .replace(/(?:sk-or-v1-|sk-ant-|sk-|AIza)[A-Za-z0-9_-]{12,}/g, "[redacted]")
      .replace(/[\r\n\t]+/g, " ")
      .slice(0, 240);
    throw new Error(`Provider request failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}.`);
  }
  if (!response.body) throw new Error("Provider returned no stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) throw new Error("Stream cancelled.");
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary).replace(/\r/g, "");
        buffer = buffer.slice(boundary + 2);
        const data = extractSseData(frame);
        if (data === "[DONE]") return;
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

  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000);
  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: requestSignal });
    if (response.ok || ![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 1) break;
    await response.body?.cancel().catch(() => {});
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 250 * (attempt + 1));
      requestSignal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("Stream cancelled.")); }, { once: true });
    });
  }
  yield* readSse(response, extract, requestSignal);
}
