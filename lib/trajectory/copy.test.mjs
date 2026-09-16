import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildTrajectoryCopyText } = await jiti.import("./copy.ts");

function record(kind, overrides = {}) {
  return {
    id: `${kind}:a1`,
    turnId: "turn:u1",
    kind,
    status: "complete",
    source: { entryId: "a1" },
    entryId: "a1",
    summary: kind,
    durationSource: "unknown",
    ...overrides,
  };
}

function detail(message, result) {
  return {
    version: 1,
    record: record("assistant"),
    entry: { id: "a1", type: "message", parentId: "u1", timestamp: "2026-01-01T00:00:00.000Z", message },
    ...(result ? { result: { id: "r1", type: "message", parentId: "a1", timestamp: "2026-01-01T00:00:01.000Z", message: result } } : {}),
  };
}

test("copies bounded long strings instead of dropping them", () => {
  const result = buildTrajectoryCopyText(
    record("user"),
    detail({ role: "user", content: { value: "long content…", truncated: true } }),
  );

  assert.equal(result, "long content…");
});

test("copies user text while representing images without base64 data", () => {
  const result = buildTrajectoryCopyText(
    record("user"),
    detail({
      role: "user",
      content: [
        { type: "text", text: "Find the graph" },
        { type: "image", mime: "image/png", bytes: 1024, sourceType: "base64" },
      ],
    }),
  );

  assert.equal(result, "Find the graph\n[image: image/png, 1024 bytes]");
});

test("copies a bounded long tool result instead of falling back to the short preview", () => {
  const result = buildTrajectoryCopyText(
    record("tool", { id: "tool:a1:tc1", kind: "tool", toolCallId: "tc1", toolName: "search", resultPreview: "short preview" }),
    detail(
      { role: "assistant", content: [{ type: "toolCall", id: "tc1", name: "search", input: {} }] },
      { role: "toolResult", toolCallId: "tc1", toolName: "search", isError: false, content: { value: "full bounded output…", truncated: true } },
    ),
  );

  assert.equal(result, 'search({})\n--- output ---\nfull bounded output…');
});

test("copies assistant text without mixing thinking or tool calls", () => {
  const result = buildTrajectoryCopyText(
    record("assistant"),
    detail({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "private reasoning" },
        { type: "text", text: "Visible answer" },
        { type: "toolCall", id: "tc1", name: "search", input: { query: "x" } },
      ],
    }),
  );

  assert.equal(result, "Visible answer");
});

test("copies a text record from its record-specific payload", () => {
  const result = buildTrajectoryCopyText(
    record("text", { id: "text:a1:1", kind: "text", blockIndex: 1 }),
    {
      ...detail({ role: "assistant", content: [{ type: "text", text: "full response" }] }),
      payload: { type: "text", text: "selected text" },
    },
  );

  assert.equal(result, "selected text");
});

test("copies thinking records independently from assistant text", () => {
  const result = buildTrajectoryCopyText(
    record("thinking"),
    detail({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "private reasoning" },
        { type: "text", text: "Visible answer" },
      ],
    }),
  );

  assert.equal(result, "private reasoning");
});

test("copies a tool call as command, arguments, and output", () => {
  const result = buildTrajectoryCopyText(
    record("tool", { id: "tool:a1:tc1", kind: "tool", toolCallId: "tc1", toolName: "search" }),
    detail(
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "tc1", name: "search", input: { query: "trajectory", limit: 20 } }],
      },
      { role: "toolResult", toolCallId: "tc1", toolName: "search", isError: false, content: "two matches" },
    ),
  );

  assert.equal(result, 'search({"query":"trajectory","limit":20})\n--- output ---\ntwo matches');
});

test("marks failed tool output and provides a stable no-output fallback", () => {
  const result = buildTrajectoryCopyText(
    record("tool", { id: "tool:a1:tc1", kind: "tool", toolCallId: "tc1", toolName: "bash", status: "error", error: "command failed" }),
    detail(
      { role: "assistant", content: [{ type: "toolCall", id: "tc1", name: "bash", input: { command: "serve" } }] },
      { role: "toolResult", toolCallId: "tc1", toolName: "bash", isError: true, content: "" },
    ),
  );

  assert.equal(result, 'bash({"command":"serve"})\n--- error ---\ncommand failed');
});


test("returns null when a persisted record has no copyable content", () => {
  const result = buildTrajectoryCopyText(
    record("assistant"),
    detail({ role: "assistant", content: [] }),
  );

  assert.equal(result, null);
});
