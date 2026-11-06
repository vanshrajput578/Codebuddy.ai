import { streamProviderResponse } from "../agent/provider-stream.mjs";

// Usage: node scripts/provider-live-smoke.mjs [provider]
// With no argument, all four providers are checked in order. With a
// provider argument (gemini, openai, openrouter, anthropic), only that
// provider is checked, which makes a single failing provider visible in
// CI and easy to re-run locally without touching the other three.
const onlyProvider = process.argv[2];
const allProviders = [
  { id: "gemini", key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL },
  { id: "openai", key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL },
  { id: "openrouter", key: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL },
  { id: "anthropic", key: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL }
];

const providers = onlyProvider
  ? allProviders.filter(provider => provider.id === onlyProvider)
  : allProviders;
if (onlyProvider && !providers.length) {
  console.error(`Unknown provider "${onlyProvider}". Use one of: gemini, openai, openrouter, anthropic.`);
  process.exit(2);
}

const missing = providers.filter(provider => !provider.key);
if (missing.length) {
  console.error("Missing live verification credentials:", missing.map(provider => provider.id).join(", "));
  console.error("Set GEMINI_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY and ANTHROPIC_API_KEY. Optional model overrides: GEMINI_MODEL, OPENAI_MODEL, OPENROUTER_MODEL, ANTHROPIC_MODEL.");
  process.exit(2);
}

const passed = [];
const failed = [];
for (const provider of providers) {
  const startedAt = Date.now();
  let output = "";
  try {
    for await (const chunk of streamProviderResponse(
      provider.id,
      provider.key,
      provider.model,
      "Reply with exactly NEXUS_STREAM_OK and no other text.",
      [],
      {}
    )) {
      output += chunk;
      if (output.length > 2000) throw new Error("Unexpectedly large smoke-test response.");
    }
    if (!output.trim()) throw new Error("Provider returned an empty stream.");
    const durationMs = Date.now() - startedAt;
    passed.push(provider.id);
    console.log(`PASS ${provider.id}: received ${output.length} streamed characters in ${durationMs}ms.`);
  } catch (error) {
    failed.push({ id: provider.id, message: error?.message || "stream verification failed" });
    console.error(`FAIL ${provider.id}: ${error?.message || "stream verification failed"}`);
  }
}
console.log(`Summary: ${passed.length} passed (${passed.join(", ") || "none"}), ${failed.length} failed (${failed.map(item => item.id).join(", ") || "none"}).`);
if (failed.length) {
  for (const item of failed) console.error(`Failed: ${item.id}: ${item.message}`);
  process.exitCode = 1;
}
