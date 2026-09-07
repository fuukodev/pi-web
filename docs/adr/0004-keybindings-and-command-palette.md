# 0004: Configurable keybindings, sequences, and a command palette

Date: 2026-02

## Status

Accepted

## Context

pi-web had exactly two hardcoded global shortcuts (Esc abort, Ctrl+Alt+N new
session). Users coming from the pi TUI — which already has a configurable
namespaced keybinding system in `~/.pi/agent/keybindings.json` — and from
neovim-style workflows asked for: quick file/session/workspace switching from
the keyboard, leader-style sequences, and dynamic rebinding.

## Decision

1. **One action catalog, runtime registry.** Actions are declared in
   `lib/keybindings/defaults.ts` (namespaced `web.*` ids mirroring the TUI
   convention). Components register handlers via `useRegisterAction`; the
   provider in `hooks/useKeybindings.tsx` owns a single window keydown
   listener and dispatches to registered handlers only. An action nobody
   listens for is never consumed, so default browser behavior is preserved.

2. **localStorage, not pi's keybindings.json.** pi parses, migrates, and
   rewrites `~/.pi/agent/keybindings.json` on startup. Sharing that file would
   create cross-tool write conflicts and semantic drift (web actions ≠ TUI
   actions). pi-web keeps overrides in `pi-web:keybindings` localStorage with
   the same binding grammar, so ids and habits transfer without shared state.

3. **Insert-mode rule.** While text inputs are focused only chords with
   ctrl/alt/meta fire; plain keys and sequences are inert. Sequences
   (`g f`) with a 1 s timeout work only outside inputs. `Escape` stays
   outside the registry entirely — the layered Esc chain (ChatInput menus →
   modals → abort handler) depends on local component state and must keep
   priority.

4. **Command palette as the keyboard surface.** Modes by query prefix
   (files / `>` commands / `@` sessions / `#` workspaces) reuse existing
   server endpoints (`/api/file-index`, session catalog already in memory) —
   no new backend routes.

## Consequences

- New keyboard features register an action + a palette command; settings UI
  and conflict detection come for free.
- `Ctrl+Alt+N` moved from `useKeyboardShortcuts.ts` into the registry; that
  hook now only owns the Esc abort chain.
- Input-box vim editing is explicitly deferred; the agreed two-phase design
  is recorded in `docs/keybindings.md` (TODO section).
