import { test } from "node:test";
import assert from "node:assert/strict";
import { getProviderCapabilities, listProviderCapabilities, extractSseData } from "../agent/provider-capabilities.mjs";

test("capability registry covers every supported provider with streaming enabled", () => {
  const providers = listProviderCapabilities();
  assert.deepEqual(providers.map(item => item.provider).sort(), ["anthropic","gemini","openai","openrouter"]);
  for (const item of providers) {
    assert.equal(item.streaming, true);
    assert.ok(item.defaultModel);
    assert.ok(item.maxOutputTokens === null || item.maxOutputTokens > 0);
  }
});

test("capability lookup validates providers and applies model defaults", () => {
  assert.equal(getProviderCapabilities("gemini").model, "gemini-3.8-flash");
  assert.equal(getProviderCapabilities("openai").model, "gpt-6-luna");
  assert.equal(getProviderCapabilities("openrouter").model, "openai/gpt-6-luna");
  assert.equal(getProviderCapabilities("anthropic").model, "claude-haiku-5-5");
  assert.equal(getProviderCapabilities("openai", "custom-model").model, "custom-model");
  assert.throws(() => getProviderCapabilities("unknown"), /Unsupported provider/);
});

test("SSE data parser safely handles JSON, empty frames and done markers", () => {
  assert.deepEqual(extractSseData("data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}"), { choices: [{ delta: { content: "hi" } }] });
  assert.equal(extractSseData("event: ping"), null);
  assert.equal(extractSseData("data: [DONE]"), null);
});
