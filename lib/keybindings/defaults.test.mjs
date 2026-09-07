import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

async function loadSubject() {
  const defaults = await jiti.import("./defaults.ts");
  const keys = await jiti.import("./keys.ts");
  return { defaults, keys };
}

test("catalog ids are unique and namespaced", async () => {
  const { defaults } = await loadSubject();
  const ids = defaults.KEYBINDING_ACTIONS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^web\.[a-z]+[a-zA-Z.]+$/);
});

test("every default binding parses and every action has i18n-ready metadata", async () => {
  const { defaults, keys } = await loadSubject();
  for (const action of defaults.KEYBINDING_ACTIONS) {
    assert.match(action.labelKey, /^shortcuts\.action\./, action.id);
    for (const binding of action.defaults) {
      const parsed = keys.parseBinding(binding);
      assert.equal(parsed.ok, true, `${action.id}: ${binding}`);
    }
  }
});

test("defaults avoid browser-reserved chords", async () => {
  const { defaults, keys } = await loadSubject();
  const reserved = new Set([
    "ctrl+t", "ctrl+w", "ctrl+n", "ctrl+shift+t", "ctrl+shift+n", // browser tabs/windows
    "ctrl+q", "ctrl+shift+q", // quit
  ]);
  for (const action of defaults.KEYBINDING_ACTIONS) {
    for (const binding of action.defaults) {
      const parsed = keys.parseBinding(binding);
      if (!parsed.ok) continue;
      const canonical = parsed.chords.map((c) => keys.serializeChord(c)).join(" ");
      assert.equal(reserved.has(canonical), false, `${action.id} uses reserved ${canonical}`);
    }
  }
});

test("no two defaults fully collide, and no sequence shares a single-chord binding", async () => {
  const { defaults, keys } = await loadSubject();
  const all = defaults.KEYBINDING_ACTIONS.flatMap((a) => a.defaults.map((binding) => ({ id: a.id, binding })));
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const left = keys.parseBinding(all[i].binding);
      const right = keys.parseBinding(all[j].binding);
      if (!left.ok || !right.ok) continue;
      const identical = left.chords.length === right.chords.length
        && left.chords.every((chord, index) => keys.chordEquals(chord, right.chords[index]));
      assert.equal(identical, false, `${all[i].id} collides with ${all[j].id}`);
    }
  }
  // A plain-key single chord would swallow sequence starters.
  const singles = all.filter((entry) => keys.parseBinding(entry.binding).ok
    && keys.parseBinding(entry.binding).chords.length === 1)
    .map((entry) => keys.parseBinding(entry.binding).chords[0]);
  for (const single of singles) {
    for (const entry of all) {
      const parsed = keys.parseBinding(entry.binding);
      if (!parsed.ok || parsed.chords.length < 2) continue;
      assert.notEqual(
        keys.chordEquals(single, parsed.chords[0]), true,
        `single chord in ${entry.id} swallows sequences`,
      );
    }
  }
});

test("every default is validatable and non-reserved (settings round-trip)", async () => {
  const { defaults, keys } = await loadSubject();
  for (const action of defaults.KEYBINDING_ACTIONS) {
    for (const binding of action.defaults) {
      assert.equal(keys.validateBinding(binding).ok, true, `${action.id}: ${binding}`);
    }
  }
});
