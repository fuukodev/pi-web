import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("offers compact quoting controls and sends selected sources to consultation children", async () => {
  const chatSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  const shellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

  assert.match(chatSource, /onPointerUp=\{captureQuotedSelection\}/);
  assert.match(chatSource, /data-consultation-kind/);
  assert.match(chatSource, /closest<HTMLElement>\("\[data-consultation-kind\]"/);
  assert.match(chatSource, /closest<HTMLElement>\("\[data-message-text\]"/);
  assert.match(chatSource, /closest<HTMLElement>\("\[data-message-role=\\"assistant\\"\]"/);
  assert.match(chatSource, /chatInputRef\?\.current\?\.insertText\(buildQuotedSelection/);
  assert.match(chatSource, /onAskInNewChat\([\s\S]*?sourceSessionId,[\s\S]*?quotedSelection\.source/);
  assert.match(chatSource, /quoteContextMode/);
  assert.match(shellSource, /\/api\/sessions\/\$\{encodeURIComponent\(sourceSessionId\)\}\/children/);
  assert.doesNotMatch(shellSource, /type: "fork_branch"/);
  assert.doesNotMatch(shellSource, /pendingQuotePrompt/);
  assert.equal((shellSource.match(/<ChatWindow\b/g) ?? []).length, 1);
  assert.match(chatSource, /role=\{quoteInputOpen \? "dialog" : "toolbar"\}/);
  assert.match(chatSource, /onAskInNewChat && quotedSelection\.source && \(/);
  assert.doesNotMatch(chatSource, /quotedSelection\.source && !sessionBusy/);
});
