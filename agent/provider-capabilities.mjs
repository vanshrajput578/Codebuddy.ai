export const PROVIDER_CAPABILITIES = Object.freeze({
  gemini: Object.freeze({ label: "Google Gemini", streaming: true, tools: true, vision: true, jsonMode: true, defaultModel: "gemini-3.8-flash", contextWindow: 1_048_576, maxOutputTokens: 65_536 }),
  openai: Object.freeze({ label: "OpenAI", streaming: true, tools: true, vision: true, jsonMode: true, defaultModel: "gpt-6-luna", contextWindow: 1_050_000, maxOutputTokens: 128_000 }),
  openrouter: Object.freeze({ label: "OpenRouter", streaming: true, tools: true, vision: true, jsonMode: true, defaultModel: "openai/gpt-6-luna", contextWindow: 1_050_000, maxOutputTokens: 128_000 }),
  anthropic: Object.freeze({ label: "Anthropic Claude", streaming: true, tools: true, vision: true, jsonMode: true, defaultModel: "claude-haiku-5-5", contextWindow: 1_000_000, maxOutputTokens: 128_000 })
});

export function getProviderCapabilities(provider, model) {
  const capability = PROVIDER_CAPABILITIES[provider];
  if (!capability) throw new Error("Unsupported provider.");
  return { provider, model: model || capability.defaultModel, ...capability };
}

export function listProviderCapabilities() {
  return Object.entries(PROVIDER_CAPABILITIES).map(([provider, capability]) => ({ provider, ...capability }));
}

export function extractSseData(frame) {
  const lines = String(frame).split(/\r?\n/);
  const dataLines = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trim());
  if (!dataLines.length) return null;
  const data = dataLines.join("\n");
  if (data === "[DONE]") return null;
  try { return JSON.parse(data); } catch {}
  // Per the SSE spec, a JSON payload may be split across several data:
  // lines. The joined text is not valid JSON in that case, so try each
  // line on its own before giving up and dropping the chunk. Gemini
  // frames have been seen in this split form.
  for (const line of dataLines) {
    try { return JSON.parse(line); } catch {}
  }
  return null;
}
