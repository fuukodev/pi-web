import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildTrajectoryPage, TrajectoryQueryError } = await jiti.import("./query.ts");

function user(id, parentId, content, timestamp) {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: { role: "user", content },
  };
}

function assistant(id, parentId, text, timestamp, toolCallId) {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "assistant",
      provider: "test",
      model: "test-model",
      content: [
        ...(toolCallId ? [{ type: "toolCall", id: toolCallId, name: "read", arguments: {} }] : []),
        { type: "text", text },
      ],
    },
  };
}

function result(id, parentId, toolCallId, timestamp) {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "toolResult",
      toolCallId,
      content: [{ type: "text", text: "done" }],
    },
  };
}

const entries = [
  user("u1", null, "one", "2026-01-01T00:00:00.000Z"),
  assistant("a1", "u1", "one answer", "2026-01-01T00:00:01.000Z", "tc1"),
  result("r1", "a1", "tc1", "2026-01-01T00:00:02.000Z"),
  user("u2", "r1", "two", "2026-01-01T00:00:03.000Z"),
  assistant("a2", "u2", "two answer", "2026-01-01T00:00:04.000Z"),
  user("u3", "a2", "three", "2026-01-01T00:00:05.000Z"),
  assistant("a3", "u3", "three answer", "2026-01-01T00:00:06.000Z"),
];

test("pages complete logical turns and returns a stable older cursor", () => {
  const page = buildTrajectoryPage(entries, null, { limit: 2 });

  assert.deepEqual(page.turns.map((turn) => turn.id), ["turn:u2", "turn:u3"]);
  assert.equal(page.turns[0].records.some((record) => record.resultEntryId === "r1"), false);
  assert.equal(page.nextCursor, "u2");
  assert.equal(page.hasEarlier, true);
  assert.equal(page.branchStats.turns, 3);
});

test("loads the page before a cursor without duplicating its boundary turn", () => {
  const page = buildTrajectoryPage(entries, null, { limit: 2, cursor: "u2" });

  assert.deepEqual(page.turns.map((turn) => turn.id), ["turn:u1"]);
  assert.equal(page.nextCursor, null);
  assert.equal(page.hasEarlier, false);
});

test("projects only the selected active branch", () => {
  const branched = [
    ...entries.slice(0, 3),
    user("main-user", "r1", "main", "2026-01-01T00:00:03.000Z"),
    assistant("main-assistant", "main-user", "main answer", "2026-01-01T00:00:04.000Z"),
    user("alt-user", "r1", "alternate", "2026-01-01T00:00:03.500Z"),
    assistant("alt-assistant", "alt-user", "alternate answer", "2026-01-01T00:00:04.500Z"),
  ];
  const page = buildTrajectoryPage(branched, "alt-assistant", { limit: 50 });

  assert.deepEqual(page.turns.map((turn) => turn.id), ["turn:u1", "turn:alt-user"]);
  assert.equal(page.turns.flatMap((turn) => turn.records).some((record) => record.entryId === "main-user"), false);
  assert.equal(page.leafId, "alt-assistant");
});

test("anchors a page on an older turn and reports newer turns", () => {
  const page = buildTrajectoryPage(entries, null, { limit: 2, anchorTurnId: "u2" });

  assert.deepEqual(page.turns.map((turn) => turn.id), ["turn:u1", "turn:u2"]);
  assert.equal(page.hasEarlier, false);
  assert.equal(page.hasLater, true);
  assert.equal(page.nextCursor, null);

  const latest = buildTrajectoryPage(entries, null, { limit: 2 });
  assert.equal(latest.hasLater, false);
});

test("rejects unknown cursors, anchors, leaves, and unsafe limits", () => {
  assert.throws(
    () => buildTrajectoryPage(entries, null, { limit: 2, cursor: "missing" }),
    (error) => error instanceof TrajectoryQueryError && error.code === "invalid_cursor",
  );
  assert.throws(
    () => buildTrajectoryPage(entries, null, { limit: 2, anchorTurnId: "missing" }),
    (error) => error instanceof TrajectoryQueryError && error.code === "invalid_anchor",
  );
  assert.throws(
    () => buildTrajectoryPage(entries, null, { limit: 2, cursor: "u2", anchorTurnId: "u2" }),
    (error) => error instanceof TrajectoryQueryError && error.code === "invalid_anchor",
  );
  assert.throws(
    () => buildTrajectoryPage(entries, "missing", { limit: 2 }),
    (error) => error instanceof TrajectoryQueryError && error.code === "invalid_leaf",
  );
  assert.throws(
    () => buildTrajectoryPage(entries, null, { limit: 0 }),
    (error) => error instanceof TrajectoryQueryError && error.code === "invalid_limit",
  );
  assert.throws(
    () => buildTrajectoryPage(entries, null, { limit: 51 }),
    (error) => error instanceof TrajectoryQueryError && error.code === "invalid_limit",
  );
});
