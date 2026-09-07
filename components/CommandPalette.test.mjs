import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./CommandPalette.tsx", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const keysSource = await readFile(new URL("../lib/file-paths.ts", import.meta.url), "utf8");

test("palette searches files through the bounded @-mention index", () => {
  assert.match(source, /\/api\/file-index\?cwd=\$\{encodeURIComponent\(activeCwd\)\}&q=\$\{encodeURIComponent\(search\)\}/);
  assert.match(source, /FILE_SEARCH_DEBOUNCE_MS/);
  assert.match(source, /AbortController/);
});

test("palette modes follow the telescope prefix convention", () => {
  assert.match(source, /query\.startsWith\(">"\)/);
  assert.match(source, /query\.startsWith\("@"\)/);
  assert.match(source, /query\.startsWith\("#"\)/);
  assert.match(source, /MODE_PREFIXES/);
});

test("palette owns its keyboard handling and never leaks to the global engine", () => {
  assert.match(source, /data-keybindings-ignore/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /aria-activedescendant/);
  assert.match(source, /role="listbox"/);
});

test("palette restores focus to the previously focused element", () => {
  assert.match(source, /restoreFocusRef/);
  assert.match(source, /previous\.isConnected/);
});

test("palette file results resolve to absolute paths like the explorer", () => {
  assert.match(source, /joinFilePath\(activeCwd, relativePath\)/);
  assert.match(keysSource, /export function joinFilePath|export const joinFilePath/);
});

test("AppShell wires every catalog action and renders the palette", () => {
  for (const action of [
    "web.palette.files",
    "web.palette.commands",
    "web.palette.sessions",
    "web.palette.workspaces",
    "web.session.new",
    "web.sidebar.toggle",
    "web.panel.toggle",
    "web.tab.next",
    "web.tab.prev",
    "web.tab.close",
    "web.settings.open",
    "web.theme.toggle",
  ]) {
    assert.match(appShellSource, new RegExp(`useRegisterAction\\("${action}"`), action);
  }
  assert.match(appShellSource, /<CommandPalette/);
  assert.match(appShellSource, /onSelectWorkspace=\{handleSelectSession\}/);
});

test("palette consumes keybindings context for binding hints", () => {
  assert.match(source, /useKeybindings\(\)/);
  assert.match(source, /bindingsFor\(command\.actionId\)/);
});
