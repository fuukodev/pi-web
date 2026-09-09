import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

async function loadSubject() {
  const storage = await jiti.import("./storage.ts");
  const { KEYBINDING_ACTIONS } = await jiti.import("./defaults.ts");
  return { storage, KEYBINDING_ACTIONS };
}

function mockStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
    _map: map,
  };
}

test("reads validated overrides and drops junk entries", async () => {
  const { storage } = await loadSubject();
  const bad = mockStorage({
    "pi-web:keybindings": JSON.stringify({
      "web.palette.files": "g o",
      "web.unknown.action": "ctrl+q", // unknown id -> dropped
      "web.session.new": "not a binding!", // unparseable -> dropped
      "web.sidebar.toggle": 42, // wrong type -> dropped
    }),
  });
  const overrides = storage.readKeybindingOverrides(bad);
  assert.deepEqual(overrides, { "web.palette.files": "g o" });
});

test("preserves explicit unassignment (empty string)", async () => {
  const { storage } = await loadSubject();
  const store = mockStorage({ "pi-web:keybindings": JSON.stringify({ "web.tab.close": "" }) });
  const overrides = storage.readKeybindingOverrides(store);
  assert.deepEqual(overrides, { "web.tab.close": "" });
});

test("tolerates malformed JSON and missing storage", async () => {
  const { storage } = await loadSubject();
  assert.deepEqual(storage.readKeybindingOverrides(null), {});
  assert.deepEqual(storage.readKeybindingOverrides(mockStorage({ "pi-web:keybindings": "{broken" })), {});
});

test("writes overrides atomically and skips invalid values", async () => {
  const { storage } = await loadSubject();
  const store = mockStorage();
  storage.writeKeybindingOverrides({
    "web.palette.files": "g o",
    "web.session.new": "###", // invalid -> skipped
    "web.nope": "ctrl+1", // unknown -> skipped
  }, store);
  assert.deepEqual(JSON.parse(store.getItem("pi-web:keybindings")), { "web.palette.files": "g o" });
});

test("resolveBindings prefers overrides including explicit unassignment", async () => {
  const { storage, KEYBINDING_ACTIONS } = await loadSubject();
  const files = KEYBINDING_ACTIONS.find((a) => a.id === "web.palette.files");
  const theme = KEYBINDING_ACTIONS.find((a) => a.id === "web.theme.toggle");
  assert.deepEqual(storage.resolveBindings("web.palette.files", { "web.palette.files": "g o" }, files.defaults), ["g o"]);
  assert.deepEqual(storage.resolveBindings("web.tab.close", { "web.tab.close": "" }, ["ctrl+alt+w"]), []);
  assert.deepEqual(storage.resolveBindings("web.theme.toggle", {}, theme.defaults), []);
  assert.deepEqual(storage.resolveBindings("web.palette.sessions", {}, ["g s"]), ["g s"]);
});
