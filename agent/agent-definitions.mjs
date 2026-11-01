import { getAgentToolNames } from "./tool-registry.mjs";

const allTools = getAgentToolNames();
const definitions = {
  general: Object.freeze({
    id: "general",
    label: "General Assistant",
    description: "A balanced assistant for planning and completing mixed tasks.",
    systemPrompt: "Act as a careful general-purpose assistant. Prefer the smallest safe plan that achieves the user's goal. Ask for approval-required actions through the normal task plan; do not bypass tool gates.",
    allowedTools: Object.freeze([...allTools])
  }),
  researcher: Object.freeze({
    id: "researcher",
    label: "Research Specialist",
    description: "Research public sources and synthesize evidence without running commands or changing memory.",
    systemPrompt: "Act as a research specialist. Compare sources, separate sourced facts from inference, capture uncertainty, and summarize findings with evidence. Do not run commands, write memory, make purchases, send messages, or take external actions.",
    allowedTools: Object.freeze(["memory.search", "math.calculate", "time.now", "browser.open", "response.compose"])
  }),
  developer: Object.freeze({
    id: "developer",
    label: "Development Specialist",
    description: "Inspect and modify explicitly attached project files inside the isolated no-network terminal.",
    systemPrompt: "Act as a software development specialist. Work only with explicitly attached task workspace files. Use terminal.run only inside the no-network disposable sandbox. Do not browse public websites, access the host filesystem, call arbitrary APIs, access secrets, or claim a build/test passed unless the command output confirms it.",
    allowedTools: Object.freeze(["memory.search", "math.calculate", "time.now", "terminal.run", "response.compose"])
  }),
  reviewer: Object.freeze({
    id: "reviewer",
    label: "Code & Evidence Reviewer",
    description: "Review public references and attached project files; identify risks and verify claims.",
    systemPrompt: "Act as a skeptical reviewer. Check assumptions, inspect supplied files or public documentation when relevant, identify concrete defects and propose bounded fixes. Do not write memory or perform unrelated external actions.",
    allowedTools: Object.freeze(["memory.search", "math.calculate", "time.now", "browser.open", "terminal.run", "response.compose"])
  })
};

for (const definition of Object.values(definitions)) {
  if (!definition.allowedTools.length || definition.allowedTools.some(tool => !allTools.includes(tool))) {
    throw new Error(`Agent profile ${definition.id} contains an unsupported tool.`);
  }
  if (!definition.allowedTools.includes("response.compose")) {
    throw new Error(`Agent profile ${definition.id} must allow response.compose.`);
  }
}

export function getAgentDefinition(id = "general") {
  const definition = definitions[id];
  if (!definition) throw new Error("Unsupported agent profile.");
  return {
    ...definition,
    allowedTools: [...definition.allowedTools]
  };
}

export function listAgentDefinitions() {
  return Object.values(definitions).map(definition => ({
    id: definition.id,
    label: definition.label,
    description: definition.description,
    allowedTools: [...definition.allowedTools]
  }));
}

export function isAgentToolAllowed(agentProfile, toolId) {
  return getAgentDefinition(agentProfile).allowedTools.includes(toolId);
}
