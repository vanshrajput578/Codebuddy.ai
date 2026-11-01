import { test } from "node:test";
import assert from "node:assert/strict";
import { getAgentDefinition, listAgentDefinitions, isAgentToolAllowed } from "../agent/agent-definitions.mjs";

test("specialized agent definitions expose only supported tools", () => {
  const profiles = listAgentDefinitions();
  assert.deepEqual(profiles.map(profile => profile.id), ["general", "researcher", "developer", "reviewer"]);
  for (const profile of profiles) {
    assert.ok(profile.label);
    assert.ok(profile.description);
    assert.ok(profile.allowedTools.includes("response.compose"));
    assert.ok(profile.allowedTools.every(tool => [
      "memory.search", "memory.save", "math.calculate", "time.now",
      "browser.open", "terminal.run", "agent.delegate", "response.compose"
    ].includes(tool)));
  }
});

test("researcher cannot run terminal commands or write memory", () => {
  assert.equal(isAgentToolAllowed("researcher", "browser.open"), true);
  assert.equal(isAgentToolAllowed("researcher", "terminal.run"), false);
  assert.equal(isAgentToolAllowed("researcher", "memory.save"), false);
});

test("developer can use isolated terminal but cannot browse or write memory", () => {
  assert.equal(isAgentToolAllowed("developer", "terminal.run"), true);
  assert.equal(isAgentToolAllowed("developer", "browser.open"), false);
  assert.equal(isAgentToolAllowed("developer", "memory.save"), false);
});

test("reviewer has read-only research and terminal scopes", () => {
  assert.equal(isAgentToolAllowed("reviewer", "browser.open"), true);
  assert.equal(isAgentToolAllowed("reviewer", "terminal.run"), true);
  assert.equal(isAgentToolAllowed("reviewer", "memory.save"), false);
});

test("unknown agent profile fails closed", () => {
  assert.throws(() => getAgentDefinition("unrestricted"), /Unsupported agent profile/);
});
