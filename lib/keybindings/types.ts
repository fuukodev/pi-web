/**
 * Keybinding types shared by the parser, defaults catalog, storage layer and
 * the React provider. The format intentionally mirrors pi TUI's
 * `~/.pi/agent/keybindings.json` grammar (`modifier+key`, space-separated
 * chords form a sequence such as `g w`), but bindings live in a separate
 * browser-local config so pi's own migration/rewrite of its file never
 * conflicts with pi-web.
 */

/** One chord: modifiers + a normalized key name ("ctrl+shift+p", "escape"). */
export interface ParsedChord {
  ctrl: boolean;
  alt: boolean;
  /**
   * Shift state. Significant only when `key` is a single letter or digit —
   * for symbol/named keys the shifted glyph is already the key name
   * (pressing Shift+/ produces "?"), so shift is ignored during matching.
   */
  shift: boolean;
  meta: boolean;
  key: string;
}

/** A parsed binding string: one or more chords ("g w" is a 2-chord sequence). */
export type ParsedBinding = ParsedChord[];

/** Reason a binding string was rejected by the parser/validator. */
export type BindingParseError =
  | "empty"
  | "syntax"
  | "unknown-key"
  | "reserved-key"
  | "missing-modifier";

export interface KeybindingActionDef {
  /** Namespaced id, e.g. "web.palette.files". */
  id: string;
  /** i18n key for the human-readable action label. */
  labelKey: string;
  /** Settings grouping; i18n key is `shortcuts.group.<group>`. */
  group: "palette" | "sessions" | "layout" | "general";
  /** Default binding strings. May be empty (palette-invokable only). */
  defaults: string[];
  /** Non-user-facing description of when the action is available. */
  availability: "global" | "workspace" | "tabs";
}

/** actionId -> user override binding string ("" means: unassigned). */
export type KeybindingOverrides = Record<string, string>;
