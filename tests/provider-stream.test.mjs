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
