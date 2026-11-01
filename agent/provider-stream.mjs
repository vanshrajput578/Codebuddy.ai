import { getProviderCapabilities, extractSseData } from "./provider-capabilities.mjs";

function messagesFor(history, prompt) {
  return [...history.map(item => ({
    role: item.role === "model" ? "assistant" : "user",
    content: item.parts?.map(part => part.text || "").join("") || ""
  })), { role: "user", content: prompt }];
}

async function* readSse(response, extract, signal) {
  if (!response.ok) throw new Error("Provider request failed.");
  if (!response.body) throw new Error("Provider returned no stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) throw new Error("Stream cancelled.");
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let boundary;
      while ((boundary = buffer.indexOf("\\n\\n")) >= 0) {
        const frame = buffer.slice(0, boundary).replace(/\\r/g, "");
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
  getProviderCapabilities(provider, model);
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

  const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: signal || AbortSignal.timeout(60_000) });
  yield* readSse(response, extract, signal);
}
