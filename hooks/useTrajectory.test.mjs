import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useTrajectory.ts", import.meta.url), "utf8");

test("loads trajectory only for an enabled saved session and aborts stale requests", () => {
  assert.match(source, /if \(!enabled \|\| !sessionId\)/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/trajectory/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /\.abort\(\)/);
});

test("pages older turns and keeps the live overlay separate from persisted data", () => {
  assert.match(source, /cursor/);
  assert.match(source, /turns: \[\.\.\.older\.turns, \.\.\.previous\.turns\]/);
  assert.match(source, /liveRecords/);
  assert.match(source, /buildLiveTrajectoryRecords/);
  assert.doesNotMatch(source, /new EventSource/);
  assert.doesNotMatch(source, /AgentEventConnection/);
});

test("initializes session timing before recording active work", () => {
  const resetIndex = source.indexOf("startsRef.current = { tools: new Map() }");
  const recordIndex = source.indexOf("const starts = startsRef.current");
  assert.ok(resetIndex >= 0);
  assert.ok(recordIndex >= 0);
  assert.ok(resetIndex < recordIndex);
});

test("refreshes persisted trajectory after a busy run settles", () => {
  assert.match(source, /wasBusyRef/);
  assert.match(source, /if \(wasBusyRef\.current && !busy && enabled/);
  assert.match(source, /reload\(\)/);
});
