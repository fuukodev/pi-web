import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { projectTrajectory } = await jiti.import("./project.ts");

function user(id, parentId, content, timestamp) {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: { role: "user", content },
  };
}

function assistant(id, parentId, content, timestamp, extra = {}) {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "assistant",
      provider: "test",
      model: "test-model",
      content,
      ...extra,
    },
  };
}

function toolResult(id, parentId, toolCallId, timestamp, extra = {}) {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "toolResult",
      toolCallId,
      toolName: toolCallId,
      content: [{ type: "text", text: `result for ${toolCallId}` }],
      ...extra,
    },
  };
}

const t0 = "2026-01-01T00:00:00.000Z";
const t1 = "2026-01-01T00:00:01.000Z";
const t2 = "2026-01-01T00:00:03.000Z";
const t3 = "2026-01-01T00:00:06.000Z";
const t4 = "2026-01-01T00:00:07.000Z";

test("projects multiple assistant tool calls and pairs each result", () => {
  const records = projectTrajectory([
    user("u1", null, "inspect the project", t0),
    assistant("a1", "u1", [
      { type: "thinking", thinking: "I should inspect both files." },
      { type: "toolCall", id: "tc1", name: "read", arguments: { path: "a.ts" } },
      { type: "toolCall", id: "tc2", name: "read", arguments: { path: "b.ts" } },
      { type: "text", text: "I inspected the project." },
    ], t1),
    toolResult("r1", "a1", "tc1", t2),
    toolResult("r2", "r1", "tc2", t3, { isError: true }),
    user("u2", "r2", "thanks", t4),
  ]);

  assert.equal(records.turns.length, 2);
  assert.deepEqual(records.turns[0].records.map((record) => record.kind), [
    "user", "assistant", "tool", "tool",
  ]);
  const [firstTool, secondTool] = records.turns[0].records.filter((record) => record.kind === "tool");
  assert.equal(firstTool.id, "tool:a1:tc1");
  assert.equal(firstTool.status, "complete");
  assert.equal(firstTool.resultEntryId, "r1");
  assert.equal(firstTool.durationMs, 2000);
  assert.equal(firstTool.durationSource, "estimated");
  assert.equal(secondTool.id, "tool:a1:tc2");
  assert.equal(secondTool.status, "error");
  assert.equal(secondTool.resultEntryId, "r2");
  assert.equal(secondTool.parentId, "entry:a1");
  assert.equal(records.turns[0].records[1].preview, "I inspected the project.");
});

test("keeps session metadata and bash/custom records in their turn", () => {
  const records = projectTrajectory([
    { type: "model_change", id: "m1", parentId: null, timestamp: t0, provider: "test", modelId: "model-a" },
    { type: "thinking_level_change", id: "l1", parentId: "m1", timestamp: t1, thinkingLevel: "high" },
    user("u1", "l1", "run checks", t2),
    {
      type: "message",
      id: "b1",
      parentId: "u1",
      timestamp: t3,
      message: { role: "bashExecution", command: "npm test", output: "ok", exitCode: 0 },
    },
    {
      type: "compaction",
      id: "c1",
      parentId: "b1",
      timestamp: t4,
      summary: "older context summarized",
      firstKeptEntryId: "u1",
      tokensBefore: 100,
    },
    {
      type: "custom_message",
      id: "x1",
      parentId: "c1",
      timestamp: t4,
      customType: "notice",
      content: "A notice",
      display: true,
    },
  ]);

  assert.equal(records.turns.length, 2);
  assert.deepEqual(records.turns[0].records.map((record) => record.kind), [
    "modelChange", "thinkingChange",
  ]);
  assert.deepEqual(records.turns[1].records.map((record) => record.kind), [
    "user", "bash", "compaction", "custom",
  ]);
  assert.equal(records.turns[1].records[1].summary, "npm test");
  assert.equal(records.turns[1].records[2].preview, "older context summarized");
});

test("retains orphaned tool results and assistant errors without inventing timing", () => {
  const records = projectTrajectory([
    user("u1", null, "recover", t0),
    assistant("a1", "u1", [{ type: "text", text: "failed" }], undefined, {
      stopReason: "error",
      errorMessage: "provider stopped",
    }),
    toolResult("orphan", "a1", "missing-call", undefined),
  ]);

  const turn = records.turns[0];
  assert.equal(turn.records[1].status, "error");
  assert.equal(turn.records[1].error, "provider stopped");
  const orphan = turn.records[2];
  assert.equal(orphan.kind, "tool");
  assert.equal(orphan.status, "unknown");
  assert.equal(orphan.resultEntryId, "orphan");
  assert.equal(orphan.durationMs, undefined);
  assert.equal(orphan.durationSource, "unknown");
});

test("projects a deep linear history iteratively", () => {
  const entries = [];
  let parentId = null;
  for (let i = 0; i < 5000; i += 1) {
    const id = `u${i}`;
    entries.push(user(id, parentId, `message ${i}`, t0));
    parentId = id;
  }

  const records = projectTrajectory(entries);
  assert.equal(records.turns.length, 5000);
  assert.equal(records.turns.at(-1).records[0].id, "entry:u4999");
});
