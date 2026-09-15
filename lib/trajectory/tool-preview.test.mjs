import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { formatToolCallPreview, MAX_TOOL_PREVIEW_LENGTH } = await jiti.import("./tool-preview.ts");

test("formats prioritized argument keys as a call signature", () => {
  assert.equal(
    formatToolCallPreview("read", { offset: 120, path: "lib/trajectory/project.ts", limit: 80 }),
    'read(path="lib/trajectory/project.ts", offset=120, limit=80)',
  );
  assert.equal(
    formatToolCallPreview("grep", { pattern: "toolCall", path: "components/" }),
    'grep(path="components/", pattern="toolCall")',
  );
  assert.equal(
    formatToolCallPreview("bash", { command: "npm test" }),
    'bash(command="npm test")',
  );
});

test("falls back to insertion order for unknown keys and caps the argument count", () => {
  assert.equal(
    formatToolCallPreview("customTool", { alpha: 1, beta: 2, gamma: 3, delta: 4 }),
    "customTool(alpha=1, beta=2, gamma=3, …)",
  );
});

test("collapses whitespace and truncates long string values", () => {
  const long = "x".repeat(200);
  const preview = formatToolCallPreview("edit", { path: "a.ts", oldText: `line one\n\n line two   ${long}` });
  assert.match(preview, /^edit\(path="a\.ts", oldText="/);
  assert.ok(preview.includes("line one line two"), preview);
  assert.ok(preview.endsWith("…\")"), preview);
  assert.ok(!preview.includes("\n"), preview);
});

test("renders arrays, objects, numbers, and booleans compactly", () => {
  assert.equal(
    formatToolCallPreview("multi", { paths: ["a", "b", "c"], options: { deep: true }, count: 3, dry: false }),
    "multi(paths=[3 items], options={…}, count=3, …)",
  );
});

test("returns only the tool name when there are no usable arguments", () => {
  assert.equal(formatToolCallPreview("read", undefined), "read");
  assert.equal(formatToolCallPreview("read", null), "read");
  assert.equal(formatToolCallPreview("read", {}), "read");
  assert.equal(formatToolCallPreview("read", "not-an-object"), "read");
});

test("keeps the preview within the shared length limit", () => {
  const preview = formatToolCallPreview("t".repeat(60), {
    path: "p".repeat(400),
    command: "c".repeat(400),
    query: "q".repeat(400),
  });
  assert.ok(preview.length <= MAX_TOOL_PREVIEW_LENGTH, `length ${preview.length}`);
  assert.ok(preview.includes("…"), preview);
});
