"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  KEYBINDING_ACTIONS,
  defaultBindingsFor,
} from "@/lib/keybindings/defaults";
import {
  chordEquals,
  chordFromEvent,
  chordUsableInInput,
  chordId,
  isTextEntryTarget,
  parseBinding,
  validateBinding,
} from "@/lib/keybindings/keys";
import {
  readKeybindingOverrides,
  resolveBindings,
  writeKeybindingOverrides,
} from "@/lib/keybindings/storage";
import type { KeybindingOverrides, ParsedChord } from "@/lib/keybindings/types";

/**
 * Runtime keybinding engine:
 *  - components register handlers for catalog actions (useRegisterAction)
 *  - one global keydown listener dispatches events to those handlers
 *  - bindings resolve as user override (localStorage) else catalog default
 *
 * Dispatch rules:
 *  - IME composition is never intercepted (matches ChatInput's guards).
 *  - Events originating inside [data-keybindings-ignore] (e.g. the command
 *    palette) are skipped so local handlers keep priority.
 *  - While a text entry target is focused, only chords with ctrl/alt/meta
 *    can fire; sequences and plain-key chords are inert (insert-mode rule).
 *  - Outside inputs, chord sequences ("g w") match through a small state
 *    machine with a 1s timeout, like tinykeys; the starter chord is consumed
 *    so "g" never leaks to the page.
 *  - An action with no registered handler is never consumed — browser
 *    defaults stay intact until a feature actually listens.
 */

interface SequenceSpec {
  actionId: string;
  chords: ParsedChord[];
}

interface PendingSequence {
  candidates: SequenceSpec[];
  depth: number;
  at: number;
}

const SEQUENCE_TIMEOUT_MS = 1000;

interface KeybindingsContextValue {
  /** Effective bindings (override else default) for display and settings. */
  bindingsFor: (actionId: string) => string[];
  /** True when the action has a persisted user override ("" counts). */
  isOverridden: (actionId: string) => boolean;
  /** Save a binding for an action; "" unassigns it. Throws on invalid input. */
  setBinding: (actionId: string, binding: string) => void;
  /** Drop any override, restoring catalog defaults. */
  resetBinding: (actionId: string) => void;
  /** Register a handler for an action; returns the unregister function. */
  registerAction: (actionId: string, handler: () => void) => () => void;
  /** Bumped whenever overrides change (lets settings UI re-render). */
  version: number;
}

const KeybindingsContext = createContext<KeybindingsContextValue | null>(null);

export function KeybindingsProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<KeybindingOverrides>({});
  const [version, setVersion] = useState(0);
  const handlersRef = useRef(new Map<string, Set<() => void>>());
  const pendingRef = useRef<PendingSequence | null>(null);
  const matchersRef = useRef<{ singles: Map<string, string[]>; sequences: SequenceSpec[] }>({
    singles: new Map(),
    sequences: [],
  });

  // Hydrate persisted overrides once on mount (client only).
  useEffect(() => {
    setOverrides(readKeybindingOverrides());
  }, []);

  // Rebuild matcher tables when overrides change.
  useEffect(() => {
    const singles = new Map<string, string[]>();
    const sequences: SequenceSpec[] = [];
    for (const action of KEYBINDING_ACTIONS) {
      const bindings = resolveBindings(action.id, overrides, action.defaults);
      for (const binding of bindings) {
        const parsed = parseBinding(binding);
        if (!parsed.ok) continue;
        if (parsed.chords.length === 1) {
          const id = chordId(parsed.chords[0]);
          const existing = singles.get(id);
          if (existing) {
            if (!existing.includes(action.id)) existing.push(action.id);
          } else {
            singles.set(id, [action.id]);
          }
        } else {
          sequences.push({ actionId: action.id, chords: parsed.chords });
        }
      }
    }
    matchersRef.current = { singles, sequences };
  }, [overrides, version]);

  const hasHandler = useCallback((actionId: string): boolean => {
    const handlers = handlersRef.current.get(actionId);
    return Boolean(handlers && handlers.size > 0);
  }, []);

  const fireAction = useCallback((actionId: string) => {
    const handlers = handlersRef.current.get(actionId);
    if (!handlers) return;
    for (const handler of [...handlers]) handler();
  }, []);

  // One global listener for the lifetime of the provider.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if (event.isComposing || event.keyCode === 229) return;
      const target = event.target;
      if (target && typeof (target as HTMLElement).closest === "function"
        && (target as HTMLElement).closest("[data-keybindings-ignore]")) {
        return;
      }
      // Escape cancels a pending sequence but is never consumed here — the
      // app's layered Escape chain (menus, modals, abort) owns that key.
      if (event.key === "Escape") {
        pendingRef.current = null;
        return;
      }
      const chord = chordFromEvent(event);
      if (!chord) return;

      if (isTextEntryTarget(target)) {
        // Insert-mode rule: only modified chords fire while typing.
        if (!chordUsableInInput(chord)) return;
        const actionIds = matchersRef.current.singles.get(chordId(chord));
        const actionable = actionIds?.filter(hasHandler) ?? [];
        if (actionable.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        for (const actionId of actionable) fireAction(actionId);
        return;
      }

      // Outside inputs: sequences first.
      const pending = pendingRef.current;
      if (pending) {
        if (Date.now() - pending.at > SEQUENCE_TIMEOUT_MS || event.repeat) {
          pendingRef.current = null;
        } else {
          const continued = pending.candidates.filter((spec) =>
            spec.chords.length > pending.depth && chordEquals(spec.chords[pending.depth], chord));
          if (continued.length > 0) {
            event.preventDefault();
            event.stopPropagation();
            const completed = continued.filter((spec) => spec.chords.length === pending.depth + 1);
            const stillPending = continued.filter((spec) => spec.chords.length > pending.depth + 1);
            pendingRef.current = stillPending.length > 0
              ? { candidates: stillPending, depth: pending.depth + 1, at: Date.now() }
              : null;
            for (const spec of completed) fireAction(spec.actionId);
            return;
          }
          // Chord does not continue the sequence — fall through as fresh key.
          pendingRef.current = null;
        }
      }

      // Single-chord bindings (plain keys allowed outside inputs).
      const singleIds = matchersRef.current.singles.get(chordId(chord));
      const actionableSingles = singleIds?.filter(hasHandler) ?? [];
      if (actionableSingles.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        for (const actionId of actionableSingles) fireAction(actionId);
        return;
      }

      // Sequence starters are consumed so "g" never reaches the page.
      const starters = matchersRef.current.sequences.filter((spec) =>
        spec.chords.length > 1 && chordEquals(spec.chords[0], chord));
      if (starters.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        const incomplete = starters.filter((spec) => spec.chords.length > 1);
        if (incomplete.length > 0 && !event.repeat) {
          pendingRef.current = { candidates: incomplete, depth: 1, at: Date.now() };
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fireAction, hasHandler]);

  const registerAction = useCallback((actionId: string, handler: () => void): (() => void) => {
    let handlers = handlersRef.current.get(actionId);
    if (!handlers) {
      handlers = new Set();
      handlersRef.current.set(actionId, handlers);
    }
    handlers.add(handler);
    return () => {
      const current = handlersRef.current.get(actionId);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) handlersRef.current.delete(actionId);
    };
  }, []);

  const bindingsFor = useCallback((actionId: string): string[] =>
    resolveBindings(actionId, overrides, defaultBindingsFor(actionId)), [overrides]);

  const isOverridden = useCallback((actionId: string): boolean =>
    overrides[actionId] !== undefined, [overrides]);

  const setBinding = useCallback((actionId: string, binding: string) => {
    if (!KEYBINDING_ACTIONS.some((action) => action.id === actionId)) {
      throw new Error(`Unknown keybinding action: ${actionId}`);
    }
    if (binding !== "") {
      const parsed = validateBinding(binding);
      if (!parsed.ok) throw new Error(`Invalid keybinding "${binding}": ${parsed.error}`);
    }
    setOverrides((previous) => {
      const next = { ...previous, [actionId]: binding };
      writeKeybindingOverrides(next);
      return next;
    });
    setVersion((v) => v + 1);
  }, []);

  const resetBinding = useCallback((actionId: string) => {
    setOverrides((previous) => {
      if (previous[actionId] === undefined) return previous;
      const next = { ...previous };
      delete next[actionId];
      writeKeybindingOverrides(next);
      return next;
    });
    setVersion((v) => v + 1);
  }, []);

  const value = useMemo<KeybindingsContextValue>(() => ({
    bindingsFor,
    isOverridden,
    setBinding,
    resetBinding,
    registerAction,
    version,
  }), [bindingsFor, isOverridden, setBinding, resetBinding, registerAction, version]);

  return <KeybindingsContext.Provider value={value}>{children}</KeybindingsContext.Provider>;
}

export function useKeybindings(): KeybindingsContextValue {
  const context = useContext(KeybindingsContext);
  if (!context) throw new Error("useKeybindings must be used inside KeybindingsProvider");
  return context;
}

/**
 * Register (and keep current) a handler for a catalog action. The handler is
 * re-registered whenever its identity changes, so callers should pass a
 * stable useCallback when the closure captures state.
 */
export function useRegisterAction(actionId: string, handler: () => void): void {
  const { registerAction } = useKeybindings();
  useEffect(() => registerAction(actionId, handler), [actionId, handler, registerAction]);
}
