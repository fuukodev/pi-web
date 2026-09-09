import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

async function loadSubject() {
  return jiti.import("./keys.ts");
}

test("parses modifier chords into canonical form", async () => {
  const { parseBinding } = await loadSubject();
  const parsed = parseBinding("ctrl+shift+p");
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.chords, [{ ctrl: true, alt: false, shift: true, meta: false, key: "p" }]);
  }
});

test("parses space-separated chords as a sequence", async () => {
  const { parseBinding } = await loadSubject();
  const parsed = parseBinding("g w");
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.chords.length, 2);
    assert.equal(parsed.chords[0].key, "g");
    assert.equal(parsed.chords[1].key, "w");
  }
});

test("parses shift+letter sequence steps like vim's gT", async () => {
  const { parseBinding } = await loadSubject();
  const parsed = parseBinding("g shift+t");
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.chords[1].key, "t");
    assert.equal(parsed.chords[1].shift, true);
  }
});

test("rejects empty, malformed and unknown bindings", async () => {
  const { parseBinding } = await loadSubject();
  assert.equal(parseBinding("").ok, false);
  assert.equal(parseBinding("   ").ok, false);
  assert.equal(parseBinding("ctrl+").ok, false);
  assert.equal(parseBinding("ctrl++p").ok, false);
  assert.equal(parseBinding("ctrl+notakey").ok, false);
  const doubleKey = parseBinding("ctrl+p+g");
  assert.equal(doubleKey.ok, false);
});

test("escape and other reserved keys are rejected unless allowed", async () => {
  const { parseBinding } = await loadSubject();
  assert.equal(parseBinding("escape").ok, false);
  assert.equal(parseBinding("escape", { allowReserved: true }).ok, true);
});

test("normalizes event keys into canonical names", async () => {
  const { normalizeKeyName } = await loadSubject();
  assert.equal(normalizeKeyName(" "), "space");
  assert.equal(normalizeKeyName("Escape"), "escape");
  assert.equal(normalizeKeyName("ArrowRight"), "right");
  assert.equal(normalizeKeyName("P"), "p");
  assert.equal(normalizeKeyName("f5"), "f5");
  assert.equal(normalizeKeyName("Shift"), null);
  assert.equal(normalizeKeyName("Bogus"), null);
});

test("chordFromEvent captures modifiers and skips modifier-only presses", async () => {
  const { chordFromEvent } = await loadSubject();
  const chord = chordFromEvent({ key: "P", ctrlKey: true, altKey: false, shiftKey: true, metaKey: false });
  assert.deepEqual(chord, { ctrl: true, alt: false, shift: true, meta: false, key: "p" });
  assert.equal(chordFromEvent({ key: "Control", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }), null);
});

test("shift only matters for letter and digit keys", async () => {
  const { chordEquals } = await loadSubject();
  const plain = { ctrl: false, alt: false, shift: false, meta: false, key: "t" };
  const shifted = { ...plain, shift: true };
  // Letters: shift distinguishes g t from g T.
  assert.equal(chordEquals(plain, shifted), false);
  // Symbols: shift is implied by the glyph, so it is ignored.
  const slash = { ctrl: false, alt: false, shift: false, meta: false, key: "?" };
  const slashShift = { ...slash, shift: true };
  assert.equal(chordEquals(slash, slashShift), true);
});

test("only modified chords are usable inside inputs", async () => {
  const { chordUsableInInput } = await loadSubject();
  assert.equal(chordUsableInInput({ ctrl: true, alt: false, shift: false, meta: false, key: "p" }), true);
  assert.equal(chordUsableInInput({ ctrl: false, alt: false, shift: true, meta: false, key: "p" }), false);
  assert.equal(chordUsableInInput({ ctrl: false, alt: false, shift: false, meta: false, key: "g" }), false);
});

test("display formatting is human readable", async () => {
  const { formatBindingForDisplay } = await loadSubject();
  assert.equal(formatBindingForDisplay("ctrl+shift+p"), "Ctrl+Shift+P");
  assert.equal(formatBindingForDisplay("g f"), "G F");
  assert.equal(formatBindingForDisplay("g shift+t"), "G Shift+T");
  assert.equal(formatBindingForDisplay("ctrl+alt+right"), "Ctrl+Alt+Right");
});

test("conflict detection follows vim semantics", async () => {
  const { findConflictingChord } = await loadSubject();
  assert.equal(findConflictingChord("ctrl+p", "g f"), null);
  // Shared sequence prefixes are by design, not a conflict.
  assert.equal(findConflictingChord("g f", "g w"), null);
  // Identical bindings collide.
  assert.notEqual(findConflictingChord("ctrl+p", "ctrl+p"), null);
  assert.notEqual(findConflictingChord("g f", "g f"), null);
  // A plain single chord would swallow a sequence starter.
  assert.notEqual(findConflictingChord("g", "g f"), null);
  assert.notEqual(findConflictingChord("g f", "g"), null);
  // Modifier chord inside a sequence is not a starter collision.
  assert.equal(findConflictingChord("ctrl+p", "g ctrl+p"), null);
});

test("text entry detection covers inputs, textareas and contenteditables", async () => {
  const { isTextEntryTarget } = await loadSubject();
  const fake = (tagName, type) => ({
    tagName,
    type,
    isContentEditable: false,
  });
  assert.equal(isTextEntryTarget(fake("TEXTAREA")), true);
  assert.equal(isTextEntryTarget(fake("INPUT", "text")), true);
  assert.equal(isTextEntryTarget(fake("INPUT", "checkbox")), false);
  assert.equal(isTextEntryTarget(fake("DIV")), false);
  assert.equal(isTextEntryTarget({ isContentEditable: true, tagName: "DIV" }), true);
  assert.equal(isTextEntryTarget(null), false);
});
