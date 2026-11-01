import { test } from "node:test";
import assert from "node:assert/strict";
import { streamProviderResponse } from "../agent/provider-stream.mjs";

test("stream adapter rejects unsupported providers before network access", async () => {
  await assert.rejects(async () => {
    for await (const _chunk of streamProviderResponse("unknown", "key", "model", "hello")) {}
  }, /Unsupported provider/);
});

test("stream adapter sends streaming OpenAI-compatible request and yields deltas", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\ndata: [DONE]\n\n', {
      status: 200, headers: { "content-type": "text/event-stream" }
    });
  };
  try {
    const chunks = [];
    for await (const chunk of streamProviderResponse("openai", "test-key-123456", "gpt-test", "Hi")) chunks.push(chunk);
    assert.deepEqual(chunks, ["Hello", " world"]);
    assert.equal(captured.url, "https://api.openai.com/v1/chat/completions");
    assert.equal(captured.body.stream, true);
    assert.equal(captured.body.messages.at(-1).content, "Hi");
  } finally { globalThis.fetch = originalFetch; }
});

test("Gemini, OpenRouter and Anthropic stream adapters use their provider protocols", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers, body: JSON.parse(options.body) });
    const provider = String(url).includes("generativelanguage") ? "gemini" : String(url).includes("openrouter") ? "openrouter" : "anthropic";
    const payload = provider === "gemini"
      ? 'data: {"candidates":[{"content":{"parts":[{"text":"Gemini"}]}}]}\n\n'
      : provider === "openrouter"
        ? 'data: {"choices":[{"delta":{"content":"Router"}}]}\n\ndata: [DONE]\n\n'
        : 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Claude"}}\n\n';
    return new Response(payload, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  try {
    const outputs = {};
    for (const provider of ["gemini", "openrouter", "anthropic"]) {
      outputs[provider] = [];
      for await (const chunk of streamProviderResponse(provider, "provider-test-key-123", "model-test", "hello")) outputs[provider].push(chunk);
    }
    assert.deepEqual(outputs, { gemini: ["Gemini"], openrouter: ["Router"], anthropic: ["Claude"] });
    assert.ok(calls[0].url.includes(":streamGenerateContent"));
    assert.equal(calls[1].body.stream, true);
    assert.equal(calls[2].body.stream, true);
    assert.equal(calls[2].headers["anthropic-version"], "2023-06-01");
  } finally { globalThis.fetch = originalFetch; }
});

test("stream adapter retries one transient provider response before streaming", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) return new Response("busy", { status: 503 });
    return new Response('data: {"choices":[{"delta":{"content":"Recovered"}}]}\n\ndata: [DONE]\n\n', { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  try {
    const chunks = [];
    for await (const chunk of streamProviderResponse("openai", "provider-test-key-123", "model-test", "hello")) chunks.push(chunk);
    assert.deepEqual(chunks, ["Recovered"]);
    assert.equal(attempts, 2);
  } finally { globalThis.fetch = originalFetch; }
});


test("stream adapter applies the registry default model when no model is configured", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), body: JSON.parse(options.body) };
    return new Response('data: {"choices":[{"delta":{"content":"Default model works"}}]}\n\ndata: [DONE]\n\n', {
      status: 200, headers: { "content-type": "text/event-stream" }
    });
  };
  try {
    const chunks = [];
    for await (const chunk of streamProviderResponse("openai", "provider-test-key-123", undefined, "hello")) chunks.push(chunk);
    assert.deepEqual(chunks, ["Default model works"]);
    assert.equal(captured.body.model, "gpt-6-luna");
  } finally { globalThis.fetch = originalFetch; }
});


test("stream adapter exposes sanitized provider diagnostics without leaking credentials", async () => {
  const originalFetch = globalThis.fetch;
  const echoedCredential = "sk-testsecret123456789012";
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { message: `Rejected key ${echoedCredential} because the model is unavailable.`, type: "invalid_request_error" }
  }), { status: 400, headers: { "content-type": "application/json" } });
  try {
    await assert.rejects(async () => {
      for await (const _chunk of streamProviderResponse("openai", "provider-test-key-123", "model-test", "hello")) {}
    }, error => {
      assert.match(error.message, /HTTP 400: Rejected key \\[redacted\\]/);
      assert.doesNotMatch(error.message, new RegExp(echoedCredential));
      return true;
    });
  } finally { globalThis.fetch = originalFetch; }
});
