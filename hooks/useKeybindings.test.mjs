import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const providerSource = await readFile(new URL("./useKeybindings.tsx", import.meta.url), "utf8");
const settingsSource = await readFile(new URL("../components/KeybindingsSettings.tsx", import.meta.url), "utf8");
const shortcutsSource = await readFile(new URL("./useKeyboardShortcuts.ts", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const settingsNavSource = await readFile(new URL("../lib/settings-navigation.ts", import.meta.url), "utf8");
const settingsPanelSource = await readFile(new URL("../components/SettingsPanel.tsx", import.meta.url), "utf8");

test("provider never intercepts IME composition events", () => {
  assert.match(providerSource, /event\.isComposing \|\| event\.keyCode === 229/);
});

test("provider skips events inside data-keybindings-ignore subtrees", () => {
  assert.match(providerSource, /closest\("\[data-keybindings-ignore\]"\)/);
});

test("sequences time out and are inert inside text inputs", () => {
  assert.match(providerSource, /SEQUENCE_TIMEOUT_MS/);
  assert.match(providerSource, /isTextEntryTarget/);
  assert.match(providerSource, /chordUsableInInput/);
});

test("actions without handlers are never consumed", () => {
  assert.match(providerSource, /hasHandler/);
  assert.match(providerSource, /actionableSingles/);
});

test("unassigned and overridden bindings persist through storage", () => {
  assert.match(providerSource, /readKeybindingOverrides/);
  assert.match(providerSource, /writeKeybindingOverrides/);
  assert.match(providerSource, /resetBinding/);
});

test("escape cancels pending sequences without being consumed", () => {
  const escBlock = providerSource.slice(
    providerSource.indexOf('if (event.key === "Escape")'),
    providerSource.indexOf("const chord = chordFromEvent"),
  );
  assert.match(escBlock, /pendingRef\.current = null/);
  assert.match(escBlock, /return;/);
  assert.doesNotMatch(escBlock, /preventDefault/);
});

test("useRegisterAction re-registers when handler identity changes", () => {
  assert.match(providerSource, /useEffect\(\(\) => registerAction\(actionId, handler\), \[actionId, handler, registerAction\]\)/);
});

test("settings UI records chords in the capture phase to preempt the dispatcher", () => {
  assert.match(settingsSource, /addEventListener\("keydown", onKeyDown, \{ capture: true \}\)/);
  assert.match(settingsSource, /findConflictingChord/);
  assert.match(settingsSource, /resetAll/);
});

test("global Escape abort shortcut stays outside the configurable registry", () => {
  assert.match(shortcutsSource, /registerAbortHandler/);
  assert.doesNotMatch(shortcutsSource, /useRegisterAction|KeybindingsProvider/);
  assert.match(pageSource, /<KeybindingsProvider>/);
});

test("settings expose a project-independent keys section", () => {
  assert.match(settingsNavSource, /"keys"/);
  assert.match(settingsPanelSource, /\{ id: "keys", label: t\("shortcuts.shortcuts"\), requiresProject: false \}/);
  assert.match(settingsPanelSource, /sectionHost\("keys", <KeybindingsSettings \/>\)/);
});
