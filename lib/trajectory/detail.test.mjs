import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildTrajectoryRecordDetail, TrajectoryDetailError } = await jiti.import("./detail.ts");

function user(id, parentId) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role: "user", content: "inspect" },
  };
}

function assistant(id, parentId) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:01.000Z",
    message: {
      role: "assistant",
      provider: "test",
      model: "test-model",
      content: [
        { type: "thinking", thinking: "private reasoning" },
        { type: "toolCall", id: "tc1", name: "read", arguments: { path: "src/index.ts" } },
        { type: "text", text: "I inspected it." },
      ],
    },
  };
}

function result(id, parentId) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:02.000Z",
    message: {
      role: "toolResult",
      toolCallId: "tc1",
      toolName: "read",
      content: [{ type: "text", text: "file contents" }],
      details: { nested: { ok: true } },
    },
  };
}

test("returns bounded assistant/tool detail without image base64 payloads", () => {
  const detail = buildTrajectoryRecordDetail([
    user("u1", null),
    assistant("a1", "u1"),
    result("r1", "a1"),
  ], "a1", "tc1");

  assert.equal(detail.record.id, "tool:a1:tc1");
  assert.equal(detail.record.resultEntryId, "r1");
  assert.equal(detail.entry.message.role, "assistant");
  assert.equal(detail.result?.message.role, "toolResult");
  assert.deepEqual(detail.entry.message.content[1].input, { path: "src/index.ts" });
  assert.equal(detail.result?.message.content[0].text, "file contents");
  assert.equal(Object.hasOwn(detail.entry.message.content[1], "data"), false);
});

test("truncates large detail strings and preserves the truncation marker", () => {
  const large = "x".repeat(100_000);
  const detail = buildTrajectoryRecordDetail([
    user("u1", null),
    {
      type: "message",
      id: "a1",
      parentId: "u1",
      timestamp: "2026-01-01T00:00:01.000Z",
      message: { role: "assistant", provider: "test", model: "test", content: [{ type: "text", text: large }] },
    },
  ], "a1");

  const text = detail.entry.message.content[0].text;
  assert.equal(text.truncated, true);
  assert.ok(text.value.length < large.length);
});

test("rejects records outside the supplied branch or with an unknown tool call", () => {
  const entries = [user("u1", null), assistant("a1", "u1")];
  assert.throws(
    () => buildTrajectoryRecordDetail(entries, "missing"),
    (error) => error instanceof TrajectoryDetailError && error.code === "not_found",
  );
  assert.throws(
    () => buildTrajectoryRecordDetail(entries, "a1", "missing-call"),
    (error) => error instanceof TrajectoryDetailError && error.code === "not_found",
  );
});

test("resolves a thinking record by id instead of the assistant record", () => {
  const entries = [user("u1", null), assistant("a1", "u1")];
  const detail = buildTrajectoryRecordDetail(entries, "a1", undefined, "thinking:a1");
  assert.equal(detail.record.id, "thinking:a1");
  assert.equal(detail.record.kind, "thinking");
  assert.match(detail.record.preview, /private reasoning/);
  assert.throws(
    () => buildTrajectoryRecordDetail(entries, "a1", undefined, "thinking:missing"),
    (error) => error instanceof TrajectoryDetailError && error.code === "not_found",
  );
});
