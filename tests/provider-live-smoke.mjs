import { streamProviderResponse } from "../agent/provider-stream.mjs";

const providers = [
  { id: "gemini", key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL },
  { id: "openai", key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL },
  { id: "openrouter", key: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL },
  { id: "anthropic", key: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL }
];

const missing = providers.filter(provider => !provider.key);
if (missing.length) {
  console.error("Missing live verification credentials:", missing.map(provider => provider.id).join(", "));
  console.error("Set GEMINI_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY and ANTHROPIC_API_KEY. Optional model overrides: GEMINI_MODEL, OPENAI_MODEL, OPENROUTER_MODEL, ANTHROPIC_MODEL.");
  process.exit(2);
}

let failed = false;
for (const provider of providers) {
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
    console.log(`PASS ${provider.id}: received ${output.length} streamed characters.`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${provider.id}: ${error?.message || "stream verification failed"}`);
  }
}
if (failed) process.exitCode = 1;
