import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeAgentResult, executeAgentTool, getAgentToolNames, getAgentToolPrompt,
  isAgentToolApprovalRequired, validateAgentToolInput
} from "../agent/tool-registry.mjs";

test("registry exposes only explicitly registered tools", () => {
  assert.deepEqual(getAgentToolNames(), [
    "memory.search", "memory.save", "math.calculate", "time.now", "response.compose"
  ]);
  assert.match(getAgentToolPrompt(), /math.calculate/);
  assert.throws(() => isAgentToolApprovalRequired("shell.exec"), /Unsupported/);
});

test("memory writes require approval while read-only tools do not", () => {
  assert.equal(isAgentToolApprovalRequired("memory.save"), true);
  assert.equal(isAgentToolApprovalRequired("memory.search"), false);
  assert.equal(isAgentToolApprovalRequired("math.calculate"), false);
  assert.equal(isAgentToolApprovalRequired("time.now"), false);
});

test("tool inputs are normalized and bounded", () => {
  assert.deepEqual(validateAgentToolInput("math.calculate", { expression: " 2 + 3 " }), { expression: "2 + 3" });
  assert.deepEqual(validateAgentToolInput("time.now", {}), { timezone: "Asia/Kolkata" });
  assert.throws(() => validateAgentToolInput("memory.search", { query: "" }), /Invalid/);
  assert.throws(() => validateAgentToolInput("memory.save", { category: "admin", content: "x" }), /category/);
  assert.throws(() => validateAgentToolInput("time.now", { timezone: "Not/AZone" }), /timezone/);
  assert.throws(() => validateAgentToolInput("shell.exec", { command: "whoami" }), /Unsupported/);
});

test("calculator evaluates arithmetic without eval or code execution", async () => {
  const result = await executeAgentTool(null, "user-id", "math.calculate", { expression: "(12 + 8) / 4 * 3" });
  assert.equal(result.value, 15);
  assert.equal(result.expression, "(12 + 8) / 4 * 3");
  const exponent = await executeAgentTool(null, "user-id", "math.calculate", { expression: "2^3^2" });
  assert.equal(exponent.value, 512);
});

test("calculator rejects unsafe syntax, division by zero and oversized exponents", async () => {
  for (const expression of ["process.exit()", "1/0", "2^13", "1 + (2", "1; console.log(1)"]) {
    await assert.rejects(
      executeAgentTool(null, "user-id", "math.calculate", { expression }),
      /unsupported|zero|Exponent|parenthesis|trailing|number/i
    );
  }
});

test("time tool returns an ISO timestamp and requested timezone", async () => {
  const result = await executeAgentTool(null, "user-id", "time.now", { timezone: "Asia/Kolkata" });
  assert.equal(result.timezone, "Asia/Kolkata");
  assert.ok(Number.isFinite(Date.parse(result.iso)));
  assert.ok(result.local.length > 0);
});

test("database tools are scoped to the supplied user", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{ id: "memory-1", category: "note", content: "private note" }] };
    }
  };
  const result = await executeAgentTool(client, "owner-id", "memory.search", { query: "private" });
  assert.equal(result.memories.length, 1);
  assert.equal(calls[0].values[0], "owner-id");
  assert.equal(calls[0].values[1], "%private%");
});


test("final answer includes bounded results from completed tools", () => {
  const result = composeAgentResult([
    { tool: "memory.search", status: "completed", result: { memories: [{ content: "Project note" }] } },
    { tool: "math.calculate", status: "completed", result: { expression: "2+2", value: 4 } },
    { tool: "response.compose", status: "completed", result: { text: "Task completed." } }
  ]);
  assert.match(result, /^Task completed\./);
  assert.match(result, /memory\.search/);
  assert.match(result, /Project note/);
  assert.match(result, /math\.calculate/);
  assert.match(result, /"value":4/);
  assert.ok(result.length <= 4000);
});

test("final answer safely handles absent or malformed tool output", () => {
  assert.equal(composeAgentResult([]), "The approved task completed.");
  assert.ok(composeAgentResult([{ tool: "math.calculate", status: "completed", result: null }]).includes("math.calculate"));
});
