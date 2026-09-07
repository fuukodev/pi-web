"use client";

import { useEffect } from "react";

// ---------------------------------------------------------------------------
// Module-level registry — ChatWindow registers the abort handler here so that
// the global Esc listener in AppShell can call it without prop-drilling.
// ---------------------------------------------------------------------------
let globalAbortHandler: (() => void) | null = null;

/**
 * Register (or clear) the abort handler for the global Esc shortcut.
 * Call this from ChatWindow whenever agentRunning or handleAbort changes.
 */
export function registerAbortHandler(handler: (() => void) | null): void {
  globalAbortHandler = handler;
}

// ---------------------------------------------------------------------------
// Hook: global Escape handling
// ---------------------------------------------------------------------------

/**
 * Register the global Esc stop-agent shortcut.
 *
 * All other keyboard shortcuts live in the configurable keybindings registry
 * (hooks/useKeybindings.tsx + lib/keybindings/*). Esc stays outside that
 * registry because the app routes it through a layered chain — ChatInput
 * menus, modals, then the abort handler here — and each layer needs intimate
 * knowledge of local state that a generic binding table cannot express.
 *
 * Note: Esc inside <textarea> or <input> is deliberately NOT handled here.
 * ChatInput manages its own Esc logic (closing slash / @ file menus, stopping
 * the agent when no menu is open) because it needs intimate knowledge of menu
 * state that is local to that component.
 */
export function useGlobalKeyboardShortcuts(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (!globalAbortHandler) return;

      const tag = (e.target as HTMLElement)?.tagName;
      // Let textarea/input handle Esc internally (ChatInput menus / stop).
      if (tag === "TEXTAREA" || tag === "INPUT") return;

      e.preventDefault();
      globalAbortHandler();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
