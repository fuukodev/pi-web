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
  assert.match(source, /block\.toolCallId === pendingSearchScroll\.toolCallId/);
  assert.doesNotMatch(source, /!sessionBusy && history\.hasEarlierMessages/);
});

test("deep jumps reveal the transcript only at the final position", () => {
  assert.match(source, /const \[locatingJump, setLocatingJump\] = useState\(false\)/);
  assert.match(source, /setLocatingJump\(true\)/);
  assert.match(source, /neededVisibleCount = newerCount \+ \(context\.entryIds\.length - indexInPage\) \+ 32/);
  assert.doesNotMatch(source, /entryIds\.length \+ attempts \* 200\) \* 2/);
  assert.match(source, /visibility: pendingScrollRestore \|\| locatingJump \? "hidden" : undefined/);
  assert.match(source, /t\("chat\.locatingMessage"\)/);
  const scrollIndex = source.indexOf("scrollToMessage(element)", source.indexOf("const selectors = ["));
  const revealIndex = source.indexOf("setLocatingJump(false)", scrollIndex);
  assert.ok(scrollIndex > 0 && revealIndex > scrollIndex, "reveal must follow the instant scroll");
});
