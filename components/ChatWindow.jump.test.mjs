import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const messageView = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");
const appShell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("tool call blocks expose the tool call id for chat jumps", () => {
  assert.match(messageView, /data-tool-call-id=\{block\.toolCallId\}/);
});

test("trajectory jumps switch back to chat and carry the tool call anchor", () => {
  assert.match(appShell, /const handleJumpToChat = useCallback/);
  assert.match(appShell, /setChatViewMode\("chat"\)/);
  assert.match(appShell, /toolCallId: target\.toolCallId/);
  assert.match(appShell, /onJumpToChat=\{handleJumpToChat\}/);
});
