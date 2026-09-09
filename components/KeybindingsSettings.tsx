"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useKeybindings } from "@/hooks/useKeybindings";
import { ConfigButton, ConfigFooter } from "./SettingsUi";
import {
  KEYBINDING_ACTIONS,
  defaultBindingsFor,
} from "@/lib/keybindings/defaults";
import {
  chordFromEvent,
  findConflictingChord,
  formatBindingForDisplay,
  serializeChord,
} from "@/lib/keybindings/keys";
import type {
  KeybindingActionDef,
  ParsedChord,
} from "@/lib/keybindings/types";

/**
 * Settings section for viewing and rebinding catalog actions.
 *
 * Follows the Models page pattern: every edit lands in a local draft and
 * only takes effect (localStorage write → global keymap rebuild) when the
 * Save button is clicked. Discard throws the draft away. Recording captures
 * up to two chords (a vim-style sequence); listeners run in the capture
 * phase and stop propagation so the global keybinding engine never sees the
 * recorded keys (e.g. ctrl+p would otherwise open the palette).
 */

/** A staged change for one action. */
type DraftEntry =
  | { kind: "binding"; binding: string }
  | { kind: "unassigned" }
  | { kind: "default" };

type DraftMap = Record<string, DraftEntry>;

const SECOND_CHORD_WINDOW_MS = 1000;

export function KeybindingsSettings() {
  const { t } = useI18n();
  const { bindingsFor, isOverridden, setBinding, resetBinding } = useKeybindings();
  const [draft, setDraft] = useState<DraftMap>({});
  const [recording, setRecording] = useState<{ actionId: string; chords: ParsedChord[] } | null>(null);
  const [conflictLabels, setConflictLabels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const recordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRecordTimer = useCallback(() => {
    if (recordTimerRef.current) {
      clearTimeout(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  }, []);

  const stopRecording = useCallback(() => {
    clearRecordTimer();
    setRecording(null);
  }, [clearRecordTimer]);

  const grouped = useMemo(() => {
    const groups = new Map<KeybindingActionDef["group"], KeybindingActionDef[]>();
    for (const action of KEYBINDING_ACTIONS) {
      const list = groups.get(action.group) ?? [];
      list.push(action);
      groups.set(action.group, list);
    }
    return [...groups.entries()];
  }, []);

  /** Bindings an action would have under a given draft (defaults-aware). */
  const resolveWith = useCallback((id: string, draftMap: DraftMap): string[] => {
    const entry = draftMap[id];
    if (!entry) return bindingsFor(id);
    if (entry.kind === "binding") return [entry.binding];
    if (entry.kind === "unassigned") return [];
    return defaultBindingsFor(id);
  }, [bindingsFor]);

  const displayBindings = useCallback((id: string): string[] =>
    resolveWith(id, draft), [resolveWith, draft]);

  /** Currently persisted binding: null = catalog defaults, "" = unassigned. */
  const persistedString = useCallback((id: string): string | null => {
    if (!isOverridden(id)) return null;
    const bindings = bindingsFor(id);
    return bindings.length === 0 ? "" : bindings[0];
  }, [bindingsFor, isOverridden]);

  const isDirtyEntry = useCallback((id: string, entry: DraftEntry): boolean => {
    const persisted = persistedString(id);
    if (entry.kind === "binding") return persisted !== entry.binding;
    if (entry.kind === "unassigned") return persisted !== "";
    return persisted !== null;
  }, [persistedString]);

  const dirtyCount = useMemo(() =>
    Object.entries(draft).filter(([id, entry]) => isDirtyEntry(id, entry)).length,
  [draft, isDirtyEntry]);

  /** Conflicts for an action under a hypothetical draft state. */
  const computeConflicts = useCallback((actionId: string, draftMap: DraftMap): string[] => {
    const own = resolveWith(actionId, draftMap);
    const labels: string[] = [];
    for (const other of KEYBINDING_ACTIONS) {
      if (other.id === actionId) continue;
      const otherBindings = resolveWith(other.id, draftMap);
      const hit = own.some((binding) =>
        otherBindings.some((otherBinding) => findConflictingChord(binding, otherBinding) !== null));
      if (hit) labels.push(other.labelKey);
    }
    return labels;
  }, [resolveWith]);

  const commitRecording = useCallback((actionId: string, chords: ParsedChord[]) => {
    const binding = chords.map(serializeChord).join(" ");
    const nextDraft: DraftMap = { ...draft, [actionId]: { kind: "binding", binding } };
    setDraft(nextDraft);
    setRecording(null);
    setConflictLabels(computeConflicts(actionId, nextDraft));
  }, [draft, computeConflicts]);

  // Global capture-phase listener active only while recording.
  useEffect(() => {
    if (!recording) return;
    const { actionId, chords: captured } = recording;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        stopRecording();
        return;
      }
      const chord = chordFromEvent(event);
      if (!chord) return; // bare modifier press — keep waiting
      const chords = [...captured, chord];
      clearRecordTimer();
      if (captured.length === 0) {
        // First chord: wait briefly for a possible second (sequence), else commit.
        setRecording({ actionId, chords });
        recordTimerRef.current = setTimeout(() => {
          commitRecording(actionId, chords);
        }, SECOND_CHORD_WINDOW_MS);
        return;
      }
      // Second chord completes the sequence immediately.
      commitRecording(actionId, chords);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [recording, stopRecording, commitRecording, clearRecordTimer]);

  useEffect(() => () => clearRecordTimer(), [clearRecordTimer]);

  const startRecording = useCallback((actionId: string) => {
    setConflictLabels([]);
    setRecording({ actionId, chords: [] });
  }, []);

  const handleDiscard = useCallback(() => {
    stopRecording();
    setDraft({});
    setConflictLabels([]);
  }, [stopRecording]);

  const handleRowReset = useCallback((actionId: string) => {
    setDraft((previous) => ({ ...previous, [actionId]: { kind: "default" } }));
    setConflictLabels([]);
  }, []);

  const handleResetAll = useCallback(() => {
    const next: DraftMap = {};
    for (const action of KEYBINDING_ACTIONS) {
      if (isOverridden(action.id)) next[action.id] = { kind: "default" };
    }
    setDraft(next);
    setConflictLabels([]);
    stopRecording();
  }, [isOverridden, stopRecording]);

  const anyPersistedOverrides = useMemo(
    () => KEYBINDING_ACTIONS.some((action) => isOverridden(action.id)),
    [isOverridden],
  );

  const handleSave = useCallback(() => {
    setSaving(true);
    try {
      for (const [id, entry] of Object.entries(draft)) {
        if (!isDirtyEntry(id, entry)) continue;
        if (entry.kind === "binding") setBinding(id, entry.binding);
        else if (entry.kind === "unassigned") setBinding(id, "");
        else resetBinding(id);
      }
      setDraft({});
      setConflictLabels([]);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
    } finally {
      setSaving(false);
    }
  }, [draft, isDirtyEntry, setBinding, resetBinding]);

  const rowShowsReset = useCallback((actionId: string): boolean => {
    const entry = draft[actionId];
    if (entry) return entry.kind !== "default" || persistedString(actionId) !== null;
    return isOverridden(actionId);
  }, [draft, isOverridden, persistedString]);

  return (
    <div className="settings-shortcuts">
      <h2 className="settings-general-title">{t("shortcuts.title")}</h2>
      <p className="settings-general-description">{t("shortcuts.description")}</p>

      {recording && (
        <div role="status" className="settings-shortcuts-recording">
          {recording.chords.length === 0
            ? t("shortcuts.recording")
            : t("shortcuts.recordingWaiting", {
              binding: formatBindingForDisplay(recording.chords.map(serializeChord).join(" ")),
            })}
        </div>
      )}
      {conflictLabels.length > 0 && !recording && (
        <p role="status" className="settings-shortcuts-conflict">
          {t("shortcuts.conflictWith", { action: conflictLabels.map((key) => t(key)).join(", ") })}
        </p>
      )}

      {grouped.map(([group, actions]) => (
        <section key={group} className="settings-general-section">
          <h3 className="settings-general-heading">{t(`shortcuts.group.${group}`)}</h3>
          <div className="settings-shortcuts-list">
            {actions.map((action) => {
              const bindings = displayBindings(action.id);
              const isRecording = recording?.actionId === action.id;
              return (
                <div key={action.id} className="settings-shortcuts-row">
                  <span className="settings-shortcuts-label">{t(action.labelKey)}</span>
                  <span className="settings-shortcuts-binding">
                    {isRecording ? (
                      <span className="settings-shortcuts-recording-chip">
                        {recording.chords.length > 0
                          ? formatBindingForDisplay(recording.chords.map(serializeChord).join(" "))
                          : "…"}
                      </span>
                    ) : bindings.length === 0 ? (
                      <span className="settings-shortcuts-unassigned">{t("shortcuts.unassigned")}</span>
                    ) : bindings.map((binding) => (
                      <kbd key={binding} className="settings-shortcuts-kbd">
                        {formatBindingForDisplay(binding)}
                      </kbd>
                    ))}
                  </span>
                  <span className="settings-shortcuts-actions">
                    {!isRecording && (
                      <button
                        type="button"
                        className="settings-shortcuts-button"
                        onClick={() => startRecording(action.id)}
                      >
                        {t("shortcuts.change")}
                      </button>
                    )}
                    {rowShowsReset(action.id) && !isRecording && (
                      <button
                        type="button"
                        className="settings-shortcuts-button"
                        onClick={() => handleRowReset(action.id)}
                      >
                        {t("shortcuts.reset")}
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <ConfigFooter
        status={dirtyCount > 0
          ? <span className="settings-shortcuts-unsaved">{t("shortcuts.unsavedChanges", { count: dirtyCount })}</span>
          : undefined}
      >
        <button
          type="button"
          className="settings-shortcuts-button"
          disabled={saving || dirtyCount === 0}
          onClick={handleDiscard}
        >
          {t("shortcuts.discard")}
        </button>
        <button
          type="button"
          className="settings-shortcuts-button"
          disabled={saving || (Object.keys(draft).length === 0 && !anyPersistedOverrides)}
          onClick={handleResetAll}
        >
          {t("shortcuts.resetAll")}
        </button>
        <ConfigButton
          variant="primary"
          onClick={handleSave}
          disabled={saving || savedOk || dirtyCount === 0}
          className={savedOk ? "is-success" : undefined}
        >
          {savedOk && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
              className="config-button-success-icon">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
          <span>{savedOk ? t("i18n.saved") : saving ? t("i18n.saving") : t("i18n.save")}</span>
        </ConfigButton>
      </ConfigFooter>
    </div>
  );
}
