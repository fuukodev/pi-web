import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pane = await readFile(new URL("./TrajectoryPane.tsx", import.meta.url), "utf8");
const ledger = await readFile(new URL("./TrajectoryLedger.tsx", import.meta.url), "utf8");
const inspector = await readFile(new URL("./TrajectoryInspector.tsx", import.meta.url), "utf8");
const overview = await readFile(new URL("./TrajectoryOverview.tsx", import.meta.url), "utf8");
const search = await readFile(new URL("./TrajectorySearch.tsx", import.meta.url), "utf8");
const globals = await readFile(new URL("../../app/globals.css", import.meta.url), "utf8");

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

test("only inspectable persisted records open the inspector and repeated clicks close it", () => {
  assert.match(pane, /isInspectableTrajectoryRecord/);
  assert.match(pane, /selectedRecord\?\.id === record\.id/);
  assert.match(pane, /const inspectorRecord =/);
  assert.match(pane, /inspectorRecord && <InspectorPanel/);
  assert.match(pane, /gridTemplateColumns:[\s\S]*inspectorRecord/);
});

test("overview keeps native button semantics inside list items", () => {
  assert.match(overview, /<div role="listitem"[\s\S]*?<button/);
  assert.doesNotMatch(overview, /<button[^>]*role="listitem"/);
});

test("overview turn and live selection navigate without opening the inspector", () => {
  assert.match(overview, /onSelectTurn/);
  assert.match(overview, /onSelectTurn\(turn\)/);
  assert.match(overview, /onSelectLive/);
  assert.match(overview, /onClick=\{onSelectLive\}/);
  assert.match(pane, /ledgerScrollRef/);
  assert.match(pane, /data-trajectory-turn/);
  assert.match(pane, /scrollTo\(/);
  assert.match(pane, /onSelectLive=\{\(\) => scrollToTurn\("turn:live"\)\}/);
});

test("trajectory records expose role colors separately from status colors", () => {
  assert.match(ledger, /data-trajectory-kind=\{record\.kind\}/);
  assert.match(ledger, /var\(--trajectory-kind-color/);
  assert.match(inspector, /data-trajectory-kind=\{record\.kind\}/);
  for (const token of ["--trajectory-user", "--trajectory-assistant", "--trajectory-thinking", "--trajectory-tool", "--trajectory-bash", "--trajectory-meta"]) {
    assert.match(globals, new RegExp(token));
  }
});

test("search button sits left of retry and opens an inline search bar", () => {
  const searchIndex = pane.indexOf('aria-label={t("trajectory.search")}');
  const retryIndex = pane.indexOf('aria-label={t("trajectory.retry")}');
  assert.ok(searchIndex > 0, "search button missing");
  assert.ok(retryIndex > 0, "retry button missing");
  assert.ok(searchIndex < retryIndex, "search button must precede retry");
  assert.match(pane, /useTrajectorySearch/);
  assert.match(pane, /<TrajectorySearch/);
});

test("search UI exposes a type selector, combobox nav, and a close control", () => {
  assert.match(search, /aria-haspopup="listbox"/);
  assert.match(search, /role="combobox"/);
  assert.match(search, /role="option"/);
  assert.match(search, /ArrowDown/);
  assert.match(search, /ArrowUp/);
  assert.match(search, /onSelectMatch/);
  assert.match(search, /trajectory\.searchClose/);
  assert.match(search, /trajectory\.searchFieldThinking/);
  assert.match(search, /scrollIntoView\(\{ block: "nearest" \}\)/);
  // The prefix hint is a tooltip only; an empty search shows no status text.
  assert.doesNotMatch(search, /\? t\("trajectory\.searchHint"\)/);
  assert.match(search, /title=\{t\("trajectory\.searchHint"\)\}/);
});

test("the header search icon button centers its glyph", () => {
  assert.match(pane, /placeItems: "center", width: 30, height: 30, padding: 0/);
});

test("selecting a search result loads its turn, selects it, and scrolls the ledger", () => {
  assert.match(pane, /ensureTurnLoaded/);
  assert.match(pane, /pendingScrollRecordId/);
  assert.match(pane, /data-trajectory-record/);
  assert.match(pane, /trajectory\.selectRecord\(match\.record\)/);
  const closeIndex = pane.indexOf('setSearchOpen(false);\n    void trajectory.selectRecord(match.record)');
  assert.ok(closeIndex > 0, "search must close before scrolling to a hit");
});

test("mobile inspector drawer takes focus, closes on escape, and restores focus", () => {
  assert.match(pane, /mobileDialogRef/);
  assert.match(pane, /mobileDialogRef\.current\?\.focus\(\)/);
  assert.match(pane, /event\.key !== "Escape"/);
  assert.match(pane, /tabIndex=\{-1\}/);
  assert.match(pane, /\[data-trajectory-record="\$\{CSS\.escape\(recordId\)\}"\][\s\S]*?\.focus\(\)/);
});

test("offers a jump to latest when an anchored page hides newer turns", () => {
  assert.match(pane, /page\?\.hasLater/);
  assert.match(pane, /trajectory\.latest/);
  assert.match(pane, /trajectory\.reload\(\)/);
});

test("inspector offers an icon jump-to-chat button left of close", () => {
  const jumpIndex = inspector.indexOf('aria-label={t("trajectory.jumpToChat")}');
  const closeIndex = inspector.indexOf('aria-label={t("trajectory.closeInspector")}');
  assert.ok(jumpIndex > 0, "jump button missing");
  assert.ok(closeIndex > 0, "close button missing");
  assert.ok(jumpIndex < closeIndex, "jump button must precede close");
  assert.match(inspector, /onJumpToChat/);
  assert.match(pane, /jumpToChat/);
  assert.match(pane, /onJumpToChat=\{\(\) => jumpToChat\(inspectorRecord\)\}/);
});

test("enter on the selected record jumps to chat while space keeps selecting", () => {
  assert.match(ledger, /if \(selected && onJump\) onJump\(record\)/);
  assert.match(ledger, /event\.key === " "/);
  assert.match(pane, /addEventListener\("keydown"/);
  assert.match(pane, /jumpToChat\(trajectory\.selectedRecord\)/);
});

test("inspector renders bounded JSON as text and links to Full History", () => {
  assert.match(inspector, /JSON\.stringify/);
  assert.match(inspector, /whiteSpace: "pre-wrap"/);
  assert.match(inspector, /trajectory\.payload/);
  assert.match(inspector, /trajectory\.result/);
  assert.match(inspector, /\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/export/);
  assert.match(inspector, /targetId/);
});
