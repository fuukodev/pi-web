import type { KeybindingActionDef } from "./types";

/**
 * The pi-web action catalog. Ids follow pi TUI's namespaced convention so a
 * future shared config stays readable; the `web.` prefix keeps them apart
 * from TUI-only `app.*` / `tui.*` actions.
 *
 * Matching rules (enforced by hooks/useKeybindings.tsx):
 *  - Single chords carrying ctrl/alt/meta fire everywhere, including while
 *    an input/textarea is focused.
 *  - Plain-key single chords and sequences ("g f") fire only outside text
 *    inputs, mirroring how vim leader keys never fire in insert mode.
 *  - `escape` is reserved: the app's layered Escape chain (menus → modals →
 *    stop agent) owns it and it is intentionally not rebindable in v1.
 */
export const KEYBINDING_ACTIONS: KeybindingActionDef[] = [
  {
    id: "web.palette.files",
    labelKey: "shortcuts.action.paletteFiles",
    group: "palette",
    defaults: ["ctrl+p", "g f"],
    availability: "workspace",
  },
  {
    id: "web.palette.commands",
    labelKey: "shortcuts.action.paletteCommands",
    group: "palette",
    defaults: ["ctrl+shift+p", "g c"],
    availability: "global",
  },
  {
    id: "web.palette.sessions",
    labelKey: "shortcuts.action.paletteSessions",
    group: "palette",
    defaults: ["g s"],
    availability: "global",
  },
  {
    id: "web.palette.workspaces",
    labelKey: "shortcuts.action.paletteWorkspaces",
    group: "palette",
    defaults: ["g w"],
    availability: "global",
  },
  {
    id: "web.session.new",
    labelKey: "shortcuts.action.sessionNew",
    group: "sessions",
    defaults: ["ctrl+alt+n"],
    availability: "workspace",
  },
  {
    id: "web.sidebar.toggle",
    labelKey: "shortcuts.action.sidebarToggle",
    group: "layout",
    defaults: ["ctrl+b"],
    availability: "global",
  },
  {
    id: "web.panel.toggle",
    labelKey: "shortcuts.action.panelToggle",
    group: "layout",
    defaults: ["ctrl+j"],
    availability: "global",
  },
  {
    id: "web.tab.next",
    labelKey: "shortcuts.action.tabNext",
    group: "layout",
    defaults: ["ctrl+alt+right", "g t"],
    availability: "tabs",
  },
  {
    id: "web.tab.prev",
    labelKey: "shortcuts.action.tabPrev",
    group: "layout",
    defaults: ["ctrl+alt+left", "g shift+t"],
    availability: "tabs",
  },
  {
    id: "web.tab.close",
    labelKey: "shortcuts.action.tabClose",
    group: "layout",
    defaults: ["ctrl+alt+w"],
    availability: "tabs",
  },
  {
    id: "web.settings.open",
    labelKey: "shortcuts.action.settingsOpen",
    group: "general",
    defaults: [],
    availability: "global",
  },
  {
    id: "web.theme.toggle",
    labelKey: "shortcuts.action.themeToggle",
    group: "general",
    defaults: [],
    availability: "global",
  },
];

export const KEYBINDING_ACTION_IDS: ReadonlySet<string> = new Set(
  KEYBINDING_ACTIONS.map((action) => action.id),
);

export function getActionDef(id: string): KeybindingActionDef | undefined {
  return KEYBINDING_ACTIONS.find((action) => action.id === id);
}

/** Default binding for an action (empty array = unassigned by default). */
export function defaultBindingsFor(id: string): string[] {
  return getActionDef(id)?.defaults ?? [];
}
