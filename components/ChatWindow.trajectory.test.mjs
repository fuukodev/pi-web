import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("keeps the trajectory hook mounted while switching between chat and trajectory", () => {
  assert.match(source, /<TrajectoryPane[\s\S]*enabled=\{viewMode === "trajectory"\}[\s\S]*\/>\s*\{viewMode === "trajectory" \? null : <>/);
});

test("forwards trajectory jumps into the chat scroll pipeline", () => {
  assert.match(source, /onJumpToChat\?: \(target: \{ entryId: string; toolCallId\?: string \}\) => void/);
  assert.match(source, /<TrajectoryPane[\s\S]*onJumpToChat=\{onJumpToChat\}/);
  assert.match(source, /\[data-tool-call-id=/);
  assert.match(source, /MAX_JUMP_PAGES/);
  assert.match(source, /trajectory\.jumpNotFound/);
  assert.match(source, /trajectory\.jumpBusy/);
  assert.match(source, /block\.toolCallId === pendingSearchScroll\.toolCallId/);
});
