# Keyboard Shortcuts & Command Palette

pi-web ships a configurable keybinding engine, a telescope-style command
palette, and leader-style key sequences (`g f`, `g w`, …). This document
describes the architecture, the default keymap, and the roadmap (including the
deliberately deferred input-box vim mode).

## Architecture

```
lib/keybindings/
  types.ts      ParsedChord / action catalog types / override map
  keys.ts       Pure parsing + matching: "ctrl+shift+p", sequences "g w",
                chord equality (shift matters for letters/digits only),
                conflict detection with vim semantics, display formatting
  defaults.ts   Action catalog: id, label i18n key, group, default bindings
  storage.ts    localStorage overrides ("pi-web:keybindings"), validated
hooks/useKeybindings.tsx
  KeybindingsProvider — one global keydown listener + action registry
  useRegisterAction(actionId, handler)
  useKeybindings() — bindingsFor / setBinding / resetBinding (settings UI)
components/CommandPalette.tsx   Telescope-style launcher (see below)
components/KeybindingsSettings.tsx  Settings section: record / reset bindings
```

Dispatch rules (enforced by the provider):

- IME composition (`isComposing` / `keyCode === 229`) is never intercepted.
- Events originating inside a `[data-keybindings-ignore]` subtree are skipped —
  the command palette uses this to own its keys.
- While a text entry target (`input`/`textarea`/`contenteditable`) is focused,
  only chords carrying `ctrl`/`alt`/`meta` can fire. Plain keys and sequences
  are inert there — the vim "insert mode" rule.
- Outside inputs, chord sequences match through a small state machine with a
  1 s timeout (like tinykeys); the starter chord is consumed.
- An action with no registered handler is never consumed — browser defaults
  stay intact until a feature listens for the action.
- `Escape` is reserved: the app's layered Escape chain (ChatInput menus →
  modals → stop agent, see `hooks/useKeyboardShortcuts.ts`) owns it, and it is
  not rebindable.

## Storage

User overrides live in browser `localStorage` under `pi-web:keybindings`
(`{ "web.palette.files": "g o", "web.tab.close": "" }` — empty string means
explicitly unassigned). We deliberately do NOT write to pi's
`~/.pi/agent/keybindings.json`: pi rewrites and migrates that file on startup,
so sharing it would risk write conflicts. The binding grammar (`modifier+key`,
space-separated chords) intentionally mirrors the TUI format, so ids and
muscle memory transfer.

## Default keymap

| Action | Default | Notes |
|---|---|---|
| `web.palette.files` | `Ctrl+P`, `g f` | Search & open files in the active workspace |
| `web.palette.commands` | `Ctrl+Shift+P`, `g c` | All registered commands |
| `web.palette.sessions` | `g s` | Session quick-switch |
| `web.palette.workspaces` | `g w` | Workspace/project switcher |
| `web.session.new` | `Ctrl+Alt+N` | New session in the active workspace |
| `web.sidebar.toggle` | `Ctrl+B` | |
| `web.panel.toggle` | `Ctrl+J` | File panel (only opens when tabs exist) |
| `web.tab.next` / `web.tab.prev` | `Ctrl+Alt+→` / `Ctrl+Alt+←`, `g t` / `g T` | Cycle file/terminal tabs |
| `web.tab.close` | `Ctrl+Alt+W` | Close active tab |
| `web.settings.open` | *(unassigned)* | Palette-invokable |
| `web.theme.toggle` | *(unassigned)* | Palette-invokable |

Sequences (`g f`, `g t`, `g T`) only fire when focus is outside text inputs.
Bindings are changed in **Settings → Keys** (record up to two chords; Esc
cancels; conflicts are reported inline) and reset individually or all at once.

## Command palette

One input, four modes selected by the leading character of the query
(telescope convention), also switchable via mode chips that show the current
binding:

- *(none)* — file search in the active workspace, served by the same bounded
  `/api/file-index` backend the `@` mention autocomplete and the file explorer
  search use; results open in the file viewer tab.
- `>` — commands (everything above plus settings/theme toggles).
- `@` — session quick-switch (name/first message/cwd fuzzy filter, client
  side over the already-loaded session catalog).
- `#` — workspaces (sessions grouped by project/worktree identity); picking
  one selects a representative session, which routes through the standard
  workspace-switch flow.

## Testing

- `lib/keybindings/*.test.mjs` — pure parser/matcher/conflict/catalog/storage
  coverage (jiti-imported, like the other lib tests).
- `components/CommandPalette.test.mjs` and `hooks/useKeybindings.test.mjs` —
  source contracts: IME guards, ignore subtree, handler-less non-consumption,
  settings wiring, and the Escape chain staying outside the registry.

## TODO: input-box vim mode (deferred)

Modal editing (Esc → normal mode → motions/Operators) inside the chat input is
**planned but not implemented**. Agreed direction from the design discussion:

1. **Phase A (textarea, no dependency)** — a `lib/vim/` modal layer over the
   existing ChatInput textarea: Esc → normal, `h j k l w b 0 $ gg G`,
   `dd yy p x i a o O ci"`, mode badge in the input toolbar. Normal mode never
   produces text, so the existing IME composition guards are naturally safe.
   Reuse this keybinding engine's chord parser for motions; register the mode
   toggle as a catalog action (e.g. `web.editor.vimToggle`).
2. **Phase B (full experience)** — replace the ChatInput `<textarea>` with
   CodeMirror 6 + `@replit/codemirror-vim` (the standard web vim engine,
   maintained by Replit; same lineage as jupyterlab-vim / Obsidian). Cost is
   concentrated in migrating slash/@-menu caret positioning to
   `coordsAtPos` and re-testing IME paths.

Constraints that must survive either phase: the layered Esc priority chain
(close menus → leave normal mode → stop agent), the IME guards in
`ChatInput.tsx` (`keyCode === 229`, composition-end grace), mobile parity
(vim off on touch), and the existing `ChatInput.test.mjs` suite.
