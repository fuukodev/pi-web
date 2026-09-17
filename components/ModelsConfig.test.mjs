import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  hasModelCostDraftValue,
  modelCostToDraft,
  parseCompleteModelCost,
  serializeHeaderRows,
  setCompatBool,
  updateHeaderRow,
} = await jiti.import("./models-config-helpers.ts");

const source = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");

test("uses shared sidebar sizing for providers and matching indented model rows", () => {
  const sidebar = source.slice(source.indexOf("<ConfigSidebar>"), source.indexOf("</ConfigSidebar>"));

  assert.match(sidebar, /<ConfigSidebarItem[\s\S]*?active=\{isSelected\}/);
  assert.match(sidebar, /<ConfigSidebarItem[\s\S]*?active=\{isProviderSelected\}/);
  assert.match(sidebar, /className="models-sidebar-indented-item"/);
  assert.match(sidebar, /className="models-sidebar-indented-item models-sidebar-add-item"/);
  assert.match(cssSource, /\.models-sidebar-indented-item \{[\s\S]*?padding-left: 26px/);
});

test("ignores malformed auth provider responses", () => {
  assert.match(
    source,
    /if \(Array\.isArray\(d\.oauthProviders\)\) setOauthProviders\(d\.oauthProviders\)/,
  );
  assert.match(
    source,
    /if \(Array\.isArray\(d\.apiKeyProviders\)\) setApiKeyProviders\(d\.apiKeyProviders\)/,
  );
});

test("custom model config exposes provider-level request headers", () => {
  const providerDetail = source.slice(
    source.indexOf("function ProviderDetail"),
    source.indexOf("// ── ThinkingLevelMap editor"),
  );
  assert.match(providerDetail, /<HeaderListEditor/);
  assert.match(providerDetail, /headers=\{provider\.headers\}/);
  assert.match(providerDetail, /set\("headers", headers\)/);
});

test("custom model config exposes model headers and supportsDeveloperRole compat flag", () => {
  // Model-level headers editor, wired to the model entry.
  assert.match(source, /headers=\{model\.headers\}/);
  assert.match(source, /set\("headers", headers\)/);

  // Model-level compat toggle reads the effective (provider+model) value so
  // hand-edited models.json settings are reflected, while writes stay on the
  // model entry as an explicit per-model override.
  assert.match(source, /effectiveCompat\(provider, model\)\["supportsDeveloperRole"\] !== false/);
  assert.match(source, /setCompatBool\(model, "supportsDeveloperRole", v\)/);
});

test("disabling the developer role writes an explicit false override", () => {
  assert.deepEqual(
    setCompatBool({ compat: { supportsStore: true } }, "supportsDeveloperRole", false),
    { compat: { supportsStore: true, supportsDeveloperRole: false } },
  );
});

test("editing a header preserves row order and stable identities", () => {
  const rows = [
    { id: 10, name: "X-First", value: "one" },
    { id: 11, name: "X-Second", value: "two" },
  ];
  const updated = updateHeaderRow(rows, 10, { name: "X-First-Edited" });

  assert.deepEqual(updated.map(({ id, name }) => ({ id, name })), [
    { id: 10, name: "X-First-Edited" },
    { id: 11, name: "X-Second" },
  ]);
  assert.deepEqual(serializeHeaderRows(updated), {
    "X-First-Edited": "one",
    "X-Second": "two",
  });
});

test("blank header drafts are omitted until they have a name", () => {
  const rows = [
    { id: 1, name: "X-Existing", value: "kept" },
    { id: 2, name: "", value: "draft value" },
  ];

  assert.deepEqual(serializeHeaderRows(rows), { "X-Existing": "kept" });
  assert.deepEqual(
    serializeHeaderRows(updateHeaderRow(rows, 2, { name: "X-Draft" })),
    { "X-Existing": "kept", "X-Draft": "draft value" },
  );
});

test("model cost drafts default blank prices to zero unless all are blank", () => {
  const complete = {
    input: "1.25",
    output: "10",
    cacheRead: "0.125",
    cacheWrite: "0",
  };
  assert.deepEqual(parseCompleteModelCost(complete), {
    input: 1.25,
    output: 10,
    cacheRead: 0.125,
    cacheWrite: 0,
  });
  assert.deepEqual(parseCompleteModelCost({ ...complete, input: "", cacheWrite: "" }), {
    input: 0,
    output: 10,
    cacheRead: 0.125,
    cacheWrite: 0,
  });
  assert.deepEqual(parseCompleteModelCost({ input: "1.25", output: "", cacheRead: "", cacheWrite: "" }), {
    input: 1.25,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
  assert.equal(parseCompleteModelCost(modelCostToDraft()), undefined);
  assert.equal(parseCompleteModelCost({ ...complete, output: "not-a-price" }), undefined);
  assert.equal(parseCompleteModelCost({ ...complete, output: "-1" }), undefined);
  assert.equal(hasModelCostDraftValue(modelCostToDraft()), false);
  assert.equal(hasModelCostDraftValue({ ...complete, cacheWrite: "" }), true);
});

test("manual price editing commits completed costs and removes only an all-blank group", () => {
  const modelDetail = source.slice(
    source.indexOf("function ModelDetail"),
    source.indexOf("// ── OAuth detail"),
  );

  assert.match(modelDetail, /const completeCost = parseCompleteModelCost\(nextDraft\)/);
  assert.match(modelDetail, /if \(completeCost\)/);
  assert.match(modelDetail, /delete nextModel\.cost/);
  assert.match(modelDetail, /const nextDraft = \{ \.\.\.costDraftRef\.current, \[key\]: value \}/);
  assert.match(modelDetail, /costDraftRef\.current = nextDraft/);
  assert.match(modelDetail, /costTemplateRef\.current/);
  assert.match(modelDetail, /value=\{costDraft\[key\]\}/);
});

test("model specs keep catalog-filled prices visible outside advanced settings", () => {
  const modelDetail = source.slice(
    source.indexOf("function ModelDetail"),
    source.indexOf("// ── OAuth detail"),
  );
  const specsIndex = modelDetail.indexOf('t("models.modelSpecs")');
  const costIndex = modelDetail.indexOf('t("models.costPerMillion")');
  const advancedIndex = modelDetail.indexOf('t("models.advancedSettings")');

  assert.ok(specsIndex >= 0);
  assert.ok(costIndex > specsIndex);
  assert.ok(advancedIndex > costIndex);
  assert.match(modelDetail, /setCostEditing\(false\)/);
  assert.match(modelDetail, /formatCost\(key\)/);
});

test("per-model settings use one primary divider before advanced settings", () => {
  const modelDetail = source.slice(
    source.indexOf("function ModelDetail"),
    source.indexOf("// ── OAuth detail"),
  );

  assert.equal(
    (modelDetail.match(/borderTop: "1px solid var\(--border\)"/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(modelDetail, /borderBottom: "1px solid var\(--border\)"/);
});

test("thinking level overrides keep explicit default, disabled, and custom controls", () => {
  const editor = source.slice(
    source.indexOf("function ThinkingLevelMapEditor"),
    source.indexOf("// ── Model detail"),
  );

  assert.match(editor, /THINKING_LEVELS\.map/);
  assert.match(editor, />\s*Default\s*</);
  assert.match(editor, />\s*Disabled\s*</);
  assert.match(editor, />\s*Custom\s*</);
  assert.match(editor, /state === "omit"/);
  assert.match(editor, /state === "null"/);
  assert.match(editor, /state === "string"/);
});

/**
 * The defaults pane is a section of ModelsConfig.tsx: `useDefaultsForm` holds the
 * draft, `DefaultsDetail` renders it, and the shared footer commits it.
 */
const defaultsSection = source.slice(
  source.indexOf("// ── Global startup defaults"),
  source.indexOf("// ── Main component"),
);

test("keeps the global startup defaults pane pinned at the top of the sidebar", () => {
  const sidebar = source.slice(source.indexOf("<ConfigSidebar>"), source.indexOf("</ConfigSidebar>"));
  const defaultsEntry = sidebar.indexOf('setSelection({ type: "defaults" })');
  const firstOAuthEntry = sidebar.indexOf('setSelection({ type: "oauth"');

  assert.ok(defaultsEntry > 0, "defaults sidebar entry is missing");
  assert.ok(
    defaultsEntry < firstOAuthEntry,
    "defaults must stay above the credential entries so it cannot be buried",
  );
  assert.match(source, /selection\.type === "defaults"\) return <DefaultsDetail key="defaults" form=\{defaultsForm\} \/>/);
  assert.match(source, /if \(selection\.type === "defaults"\) return \{ type: "defaults" \};/);
});

test("labels thinking levels with the app's shared level names", () => {
  // The dropdown must read like the composer's reasoning menu, not like raw
  // identifiers in a native select.
  assert.match(source, /import \{ THINKING_LEVEL_DESC_KEYS \} from "@\/lib\/thinking-levels"/);
  assert.match(defaultsSection, /description: THINKING_LEVEL_DESC_KEYS\[level\]/);
  assert.match(defaultsSection, /icon=\{THINKING_ICON\}/);
  assert.doesNotMatch(defaultsSection, /<option key=\{level\}/);
});

test("edits pi's global defaults through the settings API only", () => {
  assert.match(defaultsSection, /fetch\(settingsUrl\)/);
  assert.match(defaultsSection, /const settingsUrl = cwd \? `\/api\/settings\?cwd=/);
  assert.match(defaultsSection, /method: "PUT"/);
  // Global writes must never be smuggled through the models.json save button.
  assert.doesNotMatch(defaultsSection, /handleSave/);
  assert.doesNotMatch(defaultsSection, /api\/models-config/);
  assert.match(source, /selection\?\.type === "defaults" \? \(/);
});

test("holds edits in a draft until the footer Save is pressed", () => {
  // One PUT call site, inside save(); selecting a model or level only touches
  // the draft, so a half-finished selection never reaches settings.json.
  assert.equal(defaultsSection.match(/method: "PUT"/g)?.length, 1);
  assert.match(defaultsSection, /const save = useCallback\(async \(\) => \{/);
  assert.doesNotMatch(defaultsSection, /setModel = useCallback[\s\S]{0,200}fetch\(/);
  assert.doesNotMatch(defaultsSection, /setLevel = useCallback[\s\S]{0,200}fetch\(/);

  // The footer button is the only way to commit, and it needs a change.
  assert.match(source, /selection\?\.type === "defaults" \? \(\s*<ConfigButton\s+variant="primary"\s+onClick=\{\(\) => void defaultsForm\.save\(\)\}\s+disabled=\{defaultsForm\.saving \|\| !defaultsForm\.dirty\}/);
  assert.match(source, /defaultsForm\.dirty \? t\("models\.defaultsUnsaved"\) : null/);
});

test("renders thinking-level diagnostics the server judged", () => {
  // The client renders warnings from GET and PUT alike, and never recomputes
  // support from the model list it fetched for the option list.
  assert.match(defaultsSection, /setWarnings\(settings\.warnings \?\? \[\]\)/);
  assert.match(defaultsSection, /setWarnings\(body\.warnings \?\? \[\]\)/);
  assert.match(defaultsSection, /supported: warning\.supported\.join\(", "\)/);
  assert.doesNotMatch(defaultsSection, /levelUnsupported/);
  assert.doesNotMatch(defaultsSection, /getSupportedThinkingLevels/);
  // Warnings describe what is stored, so they wait for the next save.
  assert.match(defaultsSection, /\{!form\.dirty && form\.warnings\.map\(/);
});

test("documents that chat-side selection is session-scoped, not a default", async () => {
  const enSource = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
  const zhSource = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");

  for (const key of [
    "models.defaultsTitle",
    "models.defaultsScope",
    "models.defaultsModel",
    "models.defaultsThinking",
    "models.defaultsUnsaved",
    "models.warning.unsupported_thinking_level",
  ]) {
    assert.match(enSource, new RegExp(`"${key.replace(/\./g, "\\.")}":`));
    assert.match(zhSource, new RegExp(`"${key.replace(/\./g, "\\.")}":`));
  }
});

test("a superseded defaults save cannot overwrite the newest result", () => {
  assert.match(defaultsSection, /const sequence = \+\+saveSequenceRef\.current;/);
  assert.match(defaultsSection, /if \(!isCurrent\(\)\) return;/);
  assert.match(defaultsSection, /if \(isCurrent\(\)\) setSaving\(false\);/);
});
