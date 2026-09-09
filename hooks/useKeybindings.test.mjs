import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const providerSource = await readFile(new URL("./useKeybindings.tsx", import.meta.url), "utf8");
const settingsSource = await readFile(new URL("../components/KeybindingsSettings.tsx", import.meta.url), "utf8");
const shortcutsSource = await readFile(new URL("./useKeyboardShortcuts.ts", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
test("conflicts are computed against the draft, not persisted state", () => {
  assert.match(settingsSource, /computeConflicts = \(actionId: string, draftMap: DraftMap\)|const computeConflicts = useCallback\(\(actionId: string, draftMap: DraftMap\)/);
  assert.match(settingsSource, /resolveWith\(actionId, draftMap\)/);
});

const enMessages = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zhCNMessages = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");
const zhTWMessages = await readFile(new URL("../lib/i18n/messages/zh-TW.ts", import.meta.url), "utf8");
const defaultsSource = await readFile(new URL("../lib/keybindings/defaults.ts", import.meta.url), "utf8");

test("every catalog action labelKey exists in all locale packs", () => {
  const labelKeys = [...defaultsSource.matchAll(/labelKey: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(labelKeys.length >= 12, `expected catalog labelKeys, found ${labelKeys.length}`);
  for (const pack of [enMessages, zhCNMessages, zhTWMessages]) {
    for (const key of labelKeys) {
      assert.match(pack, new RegExp(`"${key}":`), `${key} missing`);
    }
  }
});

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
  assert.match(settingsSource, /resetAll|handleResetAll/);
});

test("edits are staged in a draft and only applied by Save", () => {
  // Recording writes to the local draft, never directly to the provider.
  const commitBlock = settingsSource.slice(
    settingsSource.indexOf("const commitRecording"),
    settingsSource.indexOf("// Global capture-phase listener"),
  );
  assert.match(commitBlock, /setDraft\(nextDraft\)/);
  assert.doesNotMatch(commitBlock, /setBinding|resetBinding/);
  // Save applies staged entries through the provider.
  const saveBlock = settingsSource.slice(
    settingsSource.indexOf("const handleSave"),
    settingsSource.indexOf("const rowShowsReset"),
  );
  assert.match(saveBlock, /setBinding\(id, entry.binding\)/);
  assert.match(saveBlock, /resetBinding\(id\)/);
  // Footer: primary Save + Discard, disabled while the draft is clean.
  assert.match(settingsSource, /<ConfigFooter/);
  assert.match(settingsSource, /variant="primary"/);
  assert.match(settingsSource, /t\("i18n.save"\)/);
  assert.match(settingsSource, /t\("shortcuts.discard"\)/);
  assert.match(settingsSource, /dirtyCount === 0/);
  assert.match(settingsSource, /shortcuts.unsavedChanges/);
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
