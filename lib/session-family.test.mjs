import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { getSessionFamily, listSessionFamilies } = await createJiti(import.meta.url).import("./session-family.ts");

function session(id, modified, relation) {
  return {
    path: `/tmp/${id}.jsonl`,
    id,
    cwd: "/tmp",
    created: modified,
    modified,
    messageCount: 1,
    firstMessage: id,
    ...(relation ? { relation } : {}),
  };
}

test("groups nested subagents under their main session and uses family activity for sorting", () => {
  const main = session("main", "2026-01-01T00:00:00.000Z");
  const child = session("child", "2026-01-04T00:00:00.000Z", {
    kind: "subagent", parentSessionId: "main", profile: "explore", description: "Explore", status: "completed",
  });
  const grandchild = session("grandchild", "2026-01-03T00:00:00.000Z", {
    kind: "subagent", parentSessionId: "child", profile: "review", description: "Review", status: "running",
  });
  const newerRoot = session("newer-root", "2026-01-02T00:00:00.000Z");

  const families = listSessionFamilies([main, child, grandchild, newerRoot]);
  assert.deepEqual(families.map((family) => family.root.id), ["main", "newer-root"]);
  assert.deepEqual(families[0].subagents.map((item) => item.id), ["child", "grandchild"]);
  assert.equal(getSessionFamily([main, child, grandchild], "grandchild")?.root.id, "main");
});

test("keeps consultation children out of roots while exposing them in the family", () => {
  const main = session("main", "2026-01-01T00:00:00.000Z");
  const consultation = session("consultation", "2026-01-03T00:00:00.000Z", {
    kind: "consultation", parentSessionId: "main", contextMode: "selection", promptVersion: 1,
    source: { kind: "assistant_text", entryId: "a1", blockIndex: 0, excerpt: "answer" },
  });
  const families = listSessionFamilies([main, consultation]);
  assert.deepEqual(families.map((family) => family.root.id), ["main"]);
  assert.deepEqual(families[0].consultations.map((item) => item.id), ["consultation"]);
  assert.deepEqual(families[0].children.map((item) => item.id), ["consultation"]);
  assert.equal(getSessionFamily([main, consultation], "consultation")?.root.id, "main");
});

test("does not promote orphaned or cyclic subagent metadata into the main session list", () => {
  const orphan = session("orphan", "2026-01-03T00:00:00.000Z", {
    kind: "subagent", parentSessionId: "missing", profile: "explore", description: "Explore", status: "interrupted",
  });
  const a = session("a", "2026-01-01T00:00:00.000Z", {
    kind: "subagent", parentSessionId: "b", profile: "a", description: "A", status: "interrupted",
  });
  const b = session("b", "2026-01-02T00:00:00.000Z", {
    kind: "subagent", parentSessionId: "a", profile: "b", description: "B", status: "interrupted",
  });

  assert.deepEqual(listSessionFamilies([orphan, a, b]), []);
  assert.equal(getSessionFamily([orphan, a, b], "orphan"), null);
});
