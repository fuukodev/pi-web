import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { groupTrajectoryRuns, trajectoryTurnStatus } = await jiti.import("./runs.ts");

function record(id, kind, status, agentRunId, extra = {}) {
  return { id, turnId: "turn:u1", kind, status, source: { entryId: id }, entryId: id, summary: kind, durationSource: "unknown", agentRunId, ...extra };
}

test("groups assistant records with all child records and preserves order", () => {
  const groups = groupTrajectoryRuns([
    record("u1", "user", "complete"),
    record("a1", "assistant", "complete", "entry:a1"),
    record("t1", "thinking", "complete", "entry:a1"),
    record("x1", "text", "complete", "entry:a1"),
    record("tool1", "tool", "complete", "entry:a1"),
    record("a2", "assistant", "complete", "entry:a2"),
    record("x2", "text", "complete", "entry:a2"),
  ]);

  assert.deepEqual(groups.map((group) => group.type), ["record", "run", "run"]);
  assert.deepEqual(groups[1].records.map((item) => item.id), ["a1", "t1", "x1", "tool1"]);
  assert.deepEqual(groups[2].records.map((item) => item.id), ["a2", "x2"]);
});

test("uses the final terminal record for run status", () => {
  const groups = groupTrajectoryRuns([
    record("a1", "assistant", "complete", "entry:a1"),
    record("tool1", "tool", "error", "entry:a1"),
    record("a2", "assistant", "complete", "entry:a2"),
    record("x2", "text", "complete", "entry:a2"),
  ]);

  assert.equal(groups[0].status, "error");
  assert.equal(trajectoryTurnStatus([
    record("u1", "user", "complete"),
    record("a1", "assistant", "complete", "entry:a1"),
    record("tool1", "tool", "error", "entry:a1"),
    record("a2", "assistant", "complete", "entry:a2"),
  ]), "complete");
});
