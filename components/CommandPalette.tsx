"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useI18n } from "@/hooks/useI18n";
import { useKeybindings } from "@/hooks/useKeybindings";
import { formatBindingForDisplay } from "@/lib/keybindings/keys";
import { joinFilePath, getFileName, getFileDirectory } from "@/lib/file-paths";
import { workspaceKeyOf } from "@/lib/workspace-memory";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { SessionInfo } from "@/lib/types";

/**
 * Telescope-style command palette. One input, four modes picked by the
 * leading character of the query (neovim/telescope convention):
 *   (none) → files in the active workspace via /api/file-index
 *   >      → registered commands
 *   @      → sessions (metadata quick-switch)
 *   #      → workspaces (groups sessions by project)
 * The root carries data-keybindings-ignore so the global keybinding engine
 * never competes with local input handling.
 */

export type PaletteMode = "files" | "commands" | "sessions" | "workspaces";

export interface PaletteCommand {
  id: string;
  label: string;
  /** Optional action id whose binding is shown as the row hint. */
  actionId?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  initialMode: PaletteMode | null;
  onClose: () => void;
  activeCwd: string | null;
  sessions: SessionInfo[];
  selectedSessionId: string | null;
  commands: PaletteCommand[];
  onOpenFile: (filePath: string, fileName: string) => void;
  onSelectSession: (session: SessionInfo) => void;
  /** Receives one representative session of the chosen workspace. */
  onSelectWorkspace: (session: SessionInfo) => void;
}

interface FileIndexResponse {
  matches?: Array<{ path: string; isDir: boolean }>;
}

const FILE_RESULT_LIMIT = 50;
const FILE_SEARCH_DEBOUNCE_MS = 150;

/** Case-insensitive subsequence scorer; 0 means "no match". */
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 1;
  const lowerQuery = query.toLowerCase();
  const lowerText = text.toLowerCase();
  let score = 0;
  let textIndex = 0;
  let streak = 0;
  for (const char of lowerQuery) {
    const found = lowerText.indexOf(char, textIndex);
    if (found === -1) return 0;
    streak = found === textIndex ? streak + 1 : 0;
    score += 1 + streak + (found === 0 ? 4 : 0);
    textIndex = found + 1;
  }
  // Prefer shorter candidates and earlier matches.
  return score + Math.max(0, 8 - Math.floor(text.length / 16)) + (lowerText.startsWith(lowerQuery) ? 6 : 0);
}

interface PaletteItem {
  key: string;
  title: string;
  subtitle?: string;
  hint?: string;
  active?: boolean;
  run: () => void;
}

const MODE_PREFIXES: Record<PaletteMode, string> = {
  files: "",
  commands: ">",
  sessions: "@",
  workspaces: "#",
};

function modeOfQuery(query: string): PaletteMode {
  if (query.startsWith(">")) return "commands";
  if (query.startsWith("@")) return "sessions";
  if (query.startsWith("#")) return "workspaces";
  return "files";
}

export function CommandPalette({
  open,
  initialMode,
  onClose,
  activeCwd,
  sessions,
  selectedSessionId,
  commands,
  onOpenFile,
  onSelectSession,
  onSelectWorkspace,
}: CommandPaletteProps) {
  const { t, locale } = useI18n();
  const { bindingsFor } = useKeybindings();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [fileState, setFileState] = useState<{
    loading: boolean;
    error: boolean;
    paths: string[];
  }>({ loading: false, error: false, paths: [] });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Seed the prefix whenever the palette is (re)opened for a mode.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery(initialMode ? MODE_PREFIXES[initialMode] : "");
    setActiveIndex(0);
    // Defer so the input exists before focus (component renders on open).
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open, initialMode]);

  // Restore focus to whatever held it before the palette opened.
  useEffect(() => {
    if (open) return;
    const previous = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (previous && previous.isConnected) previous.focus();
  }, [open]);

  const mode = modeOfQuery(query);
  const bareQuery = mode === "files" ? query : query.slice(1);

  // Debounced file search against the bounded @-mention index.
  useEffect(() => {
    if (!open || mode !== "files" || !activeCwd) return;
    const search = bareQuery.trim();
    if (!search) {
      setFileState({ loading: false, error: false, paths: [] });
      return;
    }
    const controller = new AbortController();
    setFileState((current) => ({ ...current, loading: true, error: false }));
    const timer = setTimeout(() => {
      fetch(`/api/file-index?cwd=${encodeURIComponent(activeCwd)}&q=${encodeURIComponent(search)}`, {
        signal: controller.signal,
      })
        .then((response) => response.ok
          ? response.json() as Promise<FileIndexResponse>
          : Promise.reject(new Error(`HTTP ${response.status}`)))
        .then((data) => {
          if (controller.signal.aborted) return;
          setFileState({
            loading: false,
            error: false,
            paths: (data.matches ?? []).filter((entry) => !entry.isDir).slice(0, FILE_RESULT_LIMIT).map((entry) => entry.path),
          });
        })
        .catch(() => {
          if (!controller.signal.aborted) setFileState({ loading: false, error: true, paths: [] });
        });
    }, FILE_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, mode, bareQuery, activeCwd]);

  const workspaces = useMemo(() => {
    const byKey = new Map<string, { key: string; representative: SessionInfo; count: number }>();
    for (const session of sessions) {
      const key = workspaceKeyOf(session);
      const existing = byKey.get(key);
      if (existing) {
        existing.count += 1;
        if (session.modified > existing.representative.modified) existing.representative = session;
      } else {
        byKey.set(key, { key, representative: session, count: 1 });
      }
    }
    return [...byKey.values()];
  }, [sessions]);

  const items = useMemo<PaletteItem[]>(() => {
    const search = bareQuery.trim();
    if (mode === "files") {
      if (!activeCwd) return [];
      if (!search) return [];
      if (fileState.error) return [];
      return fileState.paths.map((relativePath) => {
        const absolutePath = joinFilePath(activeCwd, relativePath);
        return {
          key: `file:${relativePath}`,
          title: getFileName(relativePath),
          subtitle: getFileDirectory(relativePath) || ".",
          run: () => {
            onOpenFile(absolutePath, getFileName(relativePath));
            onClose();
          },
        };
      });
    }
    if (mode === "commands") {
      return commands
        .map((command) => ({ command, score: fuzzyScore(search, command.label) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ command }) => ({
          key: `command:${command.id}`,
          title: command.label,
          hint: command.actionId
            ? formatBindingForDisplay(bindingsFor(command.actionId)[0] ?? "")
            : undefined,
          run: () => {
            onClose();
            command.run();
          },
        }));
    }
    if (mode === "sessions") {
      return sessions
        .map((session) => {
          const title = session.name || session.firstMessage || t("palette.untitledSession");
          const score = Math.max(
            fuzzyScore(search, title),
            fuzzyScore(search, session.cwd) - 2,
          );
          return { session, title, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || b.session.modified.localeCompare(a.session.modified))
        .slice(0, FILE_RESULT_LIMIT)
        .map(({ session, title }) => ({
          key: `session:${session.id}`,
          title,
          subtitle: `${session.cwd} · ${formatRelativeTime(session.modified, locale)}`,
          active: session.id === selectedSessionId,
          run: () => {
            onSelectSession(session);
            onClose();
          },
        }));
    }
    return workspaces
      .map((workspace) => {
        const name = getFileName(workspace.representative.cwd) || workspace.key;
        const score = Math.max(
          fuzzyScore(search, name),
          fuzzyScore(search, workspace.representative.cwd) - 2,
        );
        return { workspace, name, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ workspace, name }) => ({
        key: `workspace:${workspace.key}`,
        title: name,
        subtitle: `${workspace.representative.cwd} · ${t("palette.sessionCount", { count: workspace.count })}`,
        run: () => {
          onSelectWorkspace(workspace.representative);
          onClose();
        },
      }));
  }, [mode, bareQuery, activeCwd, fileState, commands, sessions, workspaces, selectedSessionId, bindingsFor, locale, t, onOpenFile, onClose, onSelectSession, onSelectWorkspace]);

  // Keep the active row in view and clamp it to the list size.
  useEffect(() => {
    setActiveIndex((current) => items.length === 0 ? 0 : Math.min(current, items.length - 1));
  }, [items.length]);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector("[aria-selected='true']");
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, items]);

  const runItem = useCallback((item: PaletteItem | undefined) => {
    if (!item) return;
    item.run();
  }, []);

  const handleInputKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => items.length === 0 ? 0 : (current + 1) % items.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => items.length === 0 ? 0 : (current - 1 + items.length) % items.length);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, items.length - 1));
      return;
    }
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      runItem(items[activeIndex]);
    }
  }, [items, activeIndex, onClose, runItem]);

  const switchMode = useCallback((nextMode: PaletteMode) => {
    setQuery(MODE_PREFIXES[nextMode]);
    setActiveIndex(0);
    inputRef.current?.focus();
  }, []);

  const bindingHint = useCallback((actionId: string): string => {
    const binding = bindingsFor(actionId)[0];
    return binding ? formatBindingForDisplay(binding) : "";
  }, [bindingsFor]);

  if (!open) return null;

  const modeChips: Array<{ mode: PaletteMode; label: string; actionId: string; disabled?: boolean }> = [
    { mode: "files", label: t("palette.mode.files"), actionId: "web.palette.files", disabled: !activeCwd },
    { mode: "commands", label: t("palette.mode.commands"), actionId: "web.palette.commands" },
    { mode: "sessions", label: t("palette.mode.sessions"), actionId: "web.palette.sessions" },
    { mode: "workspaces", label: t("palette.mode.workspaces"), actionId: "web.palette.workspaces" },
  ];

  const placeholder = mode === "files" ? t("palette.filesPlaceholder")
    : mode === "commands" ? t("palette.commandsPlaceholder")
      : mode === "sessions" ? t("palette.sessionsPlaceholder")
        : t("palette.workspacesPlaceholder");

  const showFileHint = mode === "files" && bareQuery.trim() === "";
  const showSearching = mode === "files" && fileState.loading;
  const showEmpty = !showFileHint && !showSearching && items.length === 0;

  return (
    <div
      className="command-palette-backdrop"
      data-keybindings-ignore=""
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.title")}
        className="command-palette"
      >
        <div role="tablist" aria-label={t("palette.title")} className="command-palette-modes">
          {modeChips.map((chip) => (
            <button
              key={chip.mode}
              type="button"
              role="tab"
              aria-selected={mode === chip.mode}
              disabled={chip.disabled}
              title={bindingHint(chip.actionId)}
              onClick={() => switchMode(chip.mode)}
              className="command-palette-mode-chip"
            >
              <span>{chip.label}</span>
              {bindingHint(chip.actionId) && <kbd>{bindingHint(chip.actionId)}</kbd>}
            </button>
          ))}
        </div>
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls="command-palette-list"
          aria-activedescendant={items[activeIndex] ? `command-palette-option-${activeIndex}` : undefined}
          aria-label={t("palette.title")}
          spellCheck={false}
          autoComplete="off"
          value={query}
          placeholder={placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleInputKeyDown}
          className="command-palette-input"
        />
        <ul id="command-palette-list" role="listbox" ref={listRef} className="command-palette-list">
          {showFileHint && <li role="presentation" className="command-palette-empty">{t("palette.hintEmpty")}</li>}
          {showSearching && <li role="status" className="command-palette-empty">{t("palette.searching")}</li>}
          {mode === "files" && fileState.error && (
            <li role="alert" className="command-palette-empty command-palette-error">{t("palette.searchFailed")}</li>
          )}
          {showEmpty && <li role="presentation" className="command-palette-empty">{t("palette.noMatches")}</li>}
          {items.map((item, index) => (
            <li
              key={item.key}
              id={`command-palette-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => runItem(item)}
              className={`command-palette-item${index === activeIndex ? " is-active" : ""}${item.active ? " is-current" : ""}`}
            >
              <span className="command-palette-item-title">{item.title}</span>
              {item.subtitle && <span className="command-palette-item-sub">{item.subtitle}</span>}
              {item.hint && <kbd className="command-palette-item-hint">{item.hint}</kbd>}
            </li>
          ))}
        </ul>
        <div className="command-palette-footer">{t("palette.footer")}</div>
      </div>
    </div>
  );
}
