import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pane = await readFile(new URL("./TrajectoryPane.tsx", import.meta.url), "utf8");
const ledger = await readFile(new URL("./TrajectoryLedger.tsx", import.meta.url), "utf8");
const inspector = await readFile(new URL("./TrajectoryInspector.tsx", import.meta.url), "utf8");
const overview = await readFile(new URL("./TrajectoryOverview.tsx", import.meta.url), "utf8");

test("trajectory pane separates data loading from the ledger and exposes accessible regions", () => {
  assert.match(pane, /useTrajectory\(/);
  assert.match(pane, /role="region"/);
  assert.match(pane, /aria-labelledby/);
  assert.match(pane, /TrajectoryOverview/);
  assert.match(pane, /TrajectoryLedger/);
  assert.match(pane, /TrajectoryInspector/);
  assert.match(pane, /trajectory\.loading/);
  assert.match(pane, /trajectory\.error/);
});

test("trajectory pane fills the available chat panel", () => {
  assert.match(pane, /display: "flex", flexDirection: "column", flex: 1, minWidth: 0/);
});

test("trajectory ledger makes records keyboard-selectable and supports earlier pages", () => {
  assert.match(ledger, /<button/);
  assert.match(ledger, /aria-pressed/);
  assert.match(ledger, /onKeyDown/);
  assert.match(ledger, /loadEarlier/);
  assert.match(ledger, /data-trajectory-record/);
});

test("overview keeps native button semantics inside list items", () => {
  assert.match(overview, /<div role="listitem"[\s\S]*?<button/);
  assert.doesNotMatch(overview, /<button[^>]*role="listitem"/);
});

test("overview turn selection scrolls the matching ledger turn into view", () => {
  assert.match(overview, /onSelectTurn/);
  assert.match(overview, /onSelectTurn\(turn\)/);
  assert.match(pane, /ledgerScrollRef/);
  assert.match(pane, /data-trajectory-turn/);
  assert.match(pane, /scrollTo\(/);
});

test("inspector renders bounded JSON as text and links to Full History", () => {
  assert.match(inspector, /JSON\.stringify/);
  assert.match(inspector, /whiteSpace: "pre-wrap"/);
  assert.match(inspector, /trajectory\.payload/);
  assert.match(inspector, /trajectory\.result/);
  assert.match(inspector, /\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/export/);
  assert.match(inspector, /targetId/);
});
