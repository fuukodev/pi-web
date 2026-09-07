import type { BindingParseError, ParsedBinding, ParsedChord } from "./types";

/**
 * Pure keybinding parsing/matching helpers. Everything here is browser- and
 * React-free so it can be unit-tested directly under node:test.
 */

/** Keys handled by the app's own layered Escape chain (menus, modals, abort). */
const RESERVED_KEYS = new Set(["escape", "capslock", "numlock", "scrolllock", "contextmenu", "insert", "clear", "printscreen"]);

/** Modifier key names — pressing a modifier alone never forms a chord. */
const MODIFIER_KEYS = new Set(["control", "shift", "alt", "meta", "command", "win", "cmd"]);

/** event.key -> normalized binding key name. */
const KEY_ALIASES: Record<string, string> = {
  " ": "space",
  escape: "escape",
  esc: "escape",
  enter: "enter",
  return: "enter",
  tab: "tab",
  backspace: "backspace",
  delete: "delete",
  del: "delete",
  home: "home",
  end: "end",
  pageup: "pageup",
  pagedown: "pagedown",
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
  up: "up",
  down: "down",
  left: "left",
  right: "right",
};

const MODIFIER_TOKENS = new Set(["ctrl", "control", "alt", "option", "shift", "meta", "super", "cmd", "command", "win"]);

/** Normalize an event.key (or binding token) to its canonical name. */
export function normalizeKeyName(rawKey: string): string | null {
  const lower = rawKey.toLowerCase();
  // Alias lookup precedes trimming so the space key (" ") survives.
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  const key = rawKey.trim();
  if (!key) return null;
  if (MODIFIER_KEYS.has(lower)) return null;
  // Single characters (letters, digits, symbols) are kept as-is, lowercased.
  if (key.length === 1) return lower;
  // Multi-character names we do not recognize (e.g. "f1" is fine, "foo" is not).
  return /^f([1-9]|1[0-2])$/.test(lower) ? lower : null;
}

/** True when shift participates in matching for this key (letters/digits). */
export function shiftMattersFor(key: string): boolean {
  return /^[a-z0-9]$/.test(key);
}

/** Serialize a chord back to canonical binding syntax ("ctrl+shift+p"). */
export function serializeChord(chord: ParsedChord): string {
  const parts: string[] = [];
  if (chord.ctrl) parts.push("ctrl");
  if (chord.alt) parts.push("alt");
  if (chord.shift) parts.push("shift");
  if (chord.meta) parts.push("meta");
  parts.push(chord.key);
  return parts.join("+");
}

export function chordHasKeyModifier(chord: ParsedChord): boolean {
  return chord.ctrl || chord.alt || chord.meta;
}

/**
 * Parse a binding string ("ctrl+shift+p" or the sequence "g w") into chords.
 * Returns the parse error instead of throwing so settings UI can inline it.
 */
export function parseBinding(
  binding: string,
  options: { allowReserved?: boolean } = {},
): { ok: true; chords: ParsedBinding } | { ok: false; error: BindingParseError } {
  const trimmed = binding.trim().toLowerCase();
  if (!trimmed) return { ok: false, error: "empty" };
  const chords: ParsedBinding = [];
  for (const chordSource of trimmed.split(/\s+/)) {
    const tokens = chordSource.split("+");
    const chord: ParsedChord = { ctrl: false, alt: false, shift: false, meta: false, key: "" };
    for (const token of tokens) {
      if (!token) return { ok: false, error: "syntax" };
      if (MODIFIER_TOKENS.has(token)) {
        if (token === "ctrl" || token === "control") chord.ctrl = true;
        else if (token === "alt" || token === "option") chord.alt = true;
        else if (token === "shift") chord.shift = true;
        else chord.meta = true;
        continue;
      }
      if (chord.key) return { ok: false, error: "syntax" };
      const key = normalizeKeyName(token);
      if (!key) return { ok: false, error: /^[a-z0-9]+$/.test(token) || token.length === 1 ? "unknown-key" : "syntax" };
      chord.key = key;
    }
    if (!chord.key) return { ok: false, error: "syntax" };
    if (!options.allowReserved && RESERVED_KEYS.has(chord.key)) return { ok: false, error: "reserved-key" };
    chords.push(chord);
  }
  return { ok: true, chords };
}

/**
 * Validate a user-supplied binding. Sequences of plain keys ("g f") are
 * legal — the provider simply only fires them outside text inputs, while
 * single chords fired inside inputs must carry ctrl/alt/meta (see
 * chordUsableInInput).
 */
export function validateBinding(
  binding: string,
): { ok: true; chords: ParsedBinding } | { ok: false; error: BindingParseError } {
  return parseBinding(binding);
}

/** Canonical map key for a chord, used for single-chord lookup tables. */
export function chordId(chord: ParsedChord): string {
  return serializeChord({ ...chord, shift: shiftMattersFor(chord.key) ? chord.shift : false });
}

/** Structural chord equality honoring the shift-significance rule. */
export function chordEquals(a: ParsedChord, b: ParsedChord): boolean {
  return chordId(a) === chordId(b);
}

/**
 * Extract the canonical chord from a KeyboardEvent, or null for modifier-only
 * presses and other keys that never form bindings.
 */
export function chordFromEvent(event: {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): ParsedChord | null {
  const key = normalizeKeyName(event.key);
  if (!key || RESERVED_KEYS.has(key)) return null;
  return {
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    key,
  };
}

/** True when the chord would also fire while the user is typing in an input. */
export function chordUsableInInput(chord: ParsedChord): boolean {
  // Plain character keys (and shift+letter) would steal text input; only
  // chords carrying a real modifier are safe inside inputs.
  return chordHasKeyModifier(chord);
}

/** Display form: "Ctrl+Shift+P", sequences "G W". */
export function formatBindingForDisplay(binding: string): string {
  const parsed = parseBinding(binding, { allowReserved: true });
  if (!parsed.ok) return binding;
  return parsed.chords.map((chord) => {
    const parts: string[] = [];
    if (chord.ctrl) parts.push("Ctrl");
    if (chord.alt) parts.push("Alt");
    if (chord.meta) parts.push("Meta");
    if (chord.shift && shiftMattersFor(chord.key)) parts.push("Shift");
    const keyLabel = chord.key === "space" ? "Space"
      : chord.key.length === 1 ? chord.key.toUpperCase()
        : chord.key.charAt(0).toUpperCase() + chord.key.slice(1);
    parts.push(keyLabel);
    return parts.join("+");
  }).join(" ");
}

/**
 * The chord through which two bindings interfere, or null when independent.
 * Interference rules:
 *  - identical single chords collide;
 *  - a single chord equal to a sequence's STARTER collides (the dispatcher
 *    would never know whether to fire or await the next chord);
 *  - two sequences collide only when they are the exact same chord sequence
 *    — shared prefixes ("g f" vs "g w") are the vim model, not a conflict.
 */
export function findConflictingChord(a: string, b: string): ParsedChord | null {
  const left = parseBinding(a, { allowReserved: true });
  const right = parseBinding(b, { allowReserved: true });
  if (!left.ok || !right.ok) return null;
  if (left.chords.length === 1 && right.chords.length === 1) {
    return chordEquals(left.chords[0], right.chords[0]) ? left.chords[0] : null;
  }
  if (left.chords.length === 1 && right.chords.length > 1) {
    return chordEquals(left.chords[0], right.chords[0]) ? left.chords[0] : null;
  }
  if (left.chords.length > 1 && right.chords.length === 1) {
    return chordEquals(left.chords[0], right.chords[0]) ? right.chords[0] : null;
  }
  const identical = left.chords.length === right.chords.length
    && left.chords.every((chord, index) => chordEquals(chord, right.chords[index]));
  return identical ? left.chords[0] : null;
}

/** Element check for the "don't fire while typing" rule. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  // Buttons/checkboxes respond to keys themselves but never accept text.
  const type = (element as HTMLInputElement).type;
  return !(type === "button" || type === "submit" || type === "checkbox" || type === "radio" || type === "range");
}
