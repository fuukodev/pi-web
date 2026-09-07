import { KEYBINDING_ACTION_IDS } from "./defaults";
import { parseBinding } from "./keys";
import type { KeybindingOverrides } from "./types";

/**
 * Persistence for user keybinding overrides. Stored in browser localStorage
 * (NOT pi's ~/.pi/agent/keybindings.json — pi rewrites and migrates that file
 * on startup, so pi-web keeps a separate namespace to avoid write conflicts).
 */

export const KEYBINDINGS_STORAGE_KEY = "pi-web:keybindings";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Storage may be unavailable (privacy mode); keybindings stay default.
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Load and validate overrides. Unknown action ids and unparseable bindings
 * are dropped so a hand-edited or stale entry can never break matching.
 */
export function readKeybindingOverrides(storage: StorageLike | null = getBrowserStorage()): KeybindingOverrides {
  if (!storage) return {};
  let raw: string | null;
  try {
    raw = storage.getItem(KEYBINDINGS_STORAGE_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};
  const overrides: KeybindingOverrides = {};
  for (const [id, value] of Object.entries(parsed)) {
    if (!KEYBINDING_ACTION_IDS.has(id)) continue;
    if (typeof value !== "string") continue;
    if (value === "") {
      // "" is meaningful: the user explicitly unassigned the action.
      overrides[id] = "";
      continue;
    }
    if (parseBinding(value).ok) overrides[id] = value;
  }
  return overrides;
}

/** Persist overrides atomically; null storage or failures are best-effort. */
export function writeKeybindingOverrides(
  overrides: KeybindingOverrides,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    const entries = Object.entries(overrides).filter(([id, value]) =>
      KEYBINDING_ACTION_IDS.has(id) && (value === "" || parseBinding(value).ok));
    storage.setItem(KEYBINDINGS_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Browser storage is best-effort, matching the rest of the codebase.
  }
}

/** Effective bindings for an action: override (if any) else defaults. */
export function resolveBindings(
  id: string,
  overrides: KeybindingOverrides,
  defaultBindings: string[],
): string[] {
  const override = overrides[id];
  if (override !== undefined) {
    return override === "" ? [] : [override];
  }
  return defaultBindings;
}
