import { test } from "node:test";
import assert from "node:assert/strict";
import { validateWorkspacePath } from "../computer/terminal-sandbox-runner.mjs";

test("workspace paths allow normal relative project files", () => {
  assert.equal(validateWorkspacePath("src/index.js"), "src/index.js");
  assert.equal(validateWorkspacePath("README.md"), "README.md");
  assert.equal(validateWorkspacePath("folder/subfolder/file.txt"), "folder/subfolder/file.txt");
});

test("workspace paths reject traversal, absolute paths and platform separators", () => {
  for (const value of [
    "../secret", "a/../../secret", "/etc/passwd", "\\windows\\system.ini",
    "a\\b.txt", "a//b", "./file", "a/.", "a/..", "a/\\0b",
    "a/CON", "a/file:"
  ]) assert.throws(() => validateWorkspacePath(value));
});

test("workspace paths enforce segment count and segment length", () => {
  assert.throws(() => validateWorkspacePath(Array(14).fill("x").join("/") + "/file"));
  assert.throws(() => validateWorkspacePath("a/".repeat(13) + "file"));
  assert.throws(() => validateWorkspacePath("x".repeat(81)));
});
