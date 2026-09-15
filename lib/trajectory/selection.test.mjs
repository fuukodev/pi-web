import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { isInspectableTrajectoryRecord } = await jiti.import("./selection.ts");

function record(kind, id = `entry:${kind}`) {
  return { kind, id };
}

test("only persisted user, assistant, and tool records are inspectable", () => {
  assert.equal(isInspectableTrajectoryRecord(record("user")), true);
  assert.equal(isInspectableTrajectoryRecord(record("assistant")), true);
  assert.equal(isInspectableTrajectoryRecord(record("tool")), true);
  assert.equal(isInspectableTrajectoryRecord(record("bash")), false);
  assert.equal(isInspectableTrajectoryRecord(record("compaction")), false);
  assert.equal(isInspectableTrajectoryRecord(record("custom")), false);
  assert.equal(isInspectableTrajectoryRecord(record("assistant", "live:assistant")), false);
  assert.equal(isInspectableTrajectoryRecord(null), false);
});
