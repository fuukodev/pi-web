"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useKeybindings } from "@/hooks/useKeybindings";
import {
  KEYBINDING_ACTIONS,
} from "@/lib/keybindings/defaults";
import {
  findConflictingChord,
  formatBindingForDisplay,
  serializeChord,
  chordFromEvent,
} from "@/lib/keybindings/keys";
import type { BindingParseError, KeybindingActionDef, ParsedChord } from "@/lib/keybindings/types";

/**
 * Settings section for viewing and rebinding catalog actions. Recording
 * captures up to two chords (a vim-style sequence); listeners run in the
 * capture phase and stop propagation so the global keybinding engine never
 * sees the recorded keys (e.g. ctrl+p would otherwise open the palette).
 */

interface RecordingState {
  chords: ParsedChord[];
  /** Set once the first chord has been captured; second chord completes. */
  awaitingSecond: boolean;
}

const SECOND_CHORD_WINDOW_MS = 1000;

const ERROR_REASON_KEYS: Record<BindingParseError, string> = {
  empty: "shortcuts.reason.empty",
  syntax: "shortcuts.reason.syntax",
  "unknown-key": "shortcuts.reason.unknown-key",
  "reserved-key": "shortcuts.reason.reserved-key",
  "missing-modifier": "shortcuts.reason.syntax",
};

export function KeybindingsSettings() {
  const { t } = useI18n();
  const { bindingsFor, isOverridden, setBinding, resetBinding, version } = useKeybindings();
  const [recording, setRecording] = useState<{ actionId: string; state: RecordingState } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);
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
    setError(null);
    setConflicts([]);
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

  const commitRecording = useCallback((actionId: string, chords: ParsedChord[]) => {
    const binding = chords.map(serializeChord).join(" ");
    // Conflict report (non-blocking): shared full bindings and single-vs-
    // sequence-starter collisions, using every other action's effective bindings.
    const conflicting: string[] = [];
    for (const other of KEYBINDING_ACTIONS) {
      if (other.id === actionId) continue;
      for (const otherBinding of bindingsFor(other.id)) {
        if (findConflictingChord(binding, otherBinding)) {
          conflicting.push(other.labelKey);
          break;
        }
      }
    }
    try {
      setBinding(actionId, binding);
      setError(null);
      setConflicts(conflicting);
      setRecording(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const match = /: (\w[\w-]*)$/.exec(message);
      const reason = (match?.[1] ?? "syntax") as BindingParseError;
      setError(t(ERROR_REASON_KEYS[reason] ?? "shortcuts.reason.syntax"));
    }
  }, [bindingsFor, setBinding, t]);

  // Global capture-phase listener active only while recording.
  useEffect(() => {
    if (!recording) return;
    const { actionId, state } = recording;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        stopRecording();
        return;
      }
      const chord = chordFromEvent(event);
      if (!chord) return; // bare modifier press — keep waiting
      const chords = [...state.chords, chord];
      clearRecordTimer();
      if (state.chords.length === 0) {
        // First chord: wait briefly for a possible second (sequence), else commit.
        setRecording({ actionId, state: { chords, awaitingSecond: true } });
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
    setError(null);
    setConflicts([]);
    setRecording({ actionId, state: { chords: [], awaitingSecond: false } });
  }, []);

  const resetAll = useCallback(() => {
    for (const action of KEYBINDING_ACTIONS) {
      if (isOverridden(action.id)) resetBinding(action.id);
    }
    stopRecording();
  }, [isOverridden, resetBinding, stopRecording]);

  return (
    <div className="settings-shortcuts" key={version}>
      <h2 className="settings-general-title">{t("shortcuts.title")}</h2>
      <p className="settings-general-description">{t("shortcuts.description")}</p>

      {recording && (
        <div role="status" className="settings-shortcuts-recording">
          {recording.state.chords.length === 0
            ? t("shortcuts.recording")
            : t("shortcuts.recordingWaiting", {
              binding: formatBindingForDisplay(recording.state.chords.map(serializeChord).join(" ")),
            })}
        </div>
      )}
      {error && <p role="alert" className="settings-general-error">{error}</p>}
      {conflicts.length > 0 && !recording && (
        <p role="status" className="settings-shortcuts-conflict">
          {t("shortcuts.conflictWith", { action: conflicts.map((key) => t(key)).join(", ") })}
        </p>
      )}

      {grouped.map(([group, actions]) => (
        <section key={group} className="settings-general-section">
          <h3 className="settings-general-heading">{t(`shortcuts.group.${group}`)}</h3>
          <div className="settings-shortcuts-list">
            {actions.map((action) => {
              const bindings = bindingsFor(action.id);
              const isRecording = recording?.actionId === action.id;
              return (
                <div key={action.id} className="settings-shortcuts-row">
                  <span className="settings-shortcuts-label">{t(action.labelKey)}</span>
                  <span className="settings-shortcuts-binding">
                    {isRecording ? (
                      <span className="settings-shortcuts-recording-chip">
                        {recording.state.chords.length > 0
                          ? formatBindingForDisplay(recording.state.chords.map(serializeChord).join(" "))
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
                    {isOverridden(action.id) && !isRecording && (
                      <button
                        type="button"
                        className="settings-shortcuts-button"
                        onClick={() => { stopRecording(); resetBinding(action.id); }}
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

      <div className="settings-shortcuts-footer">
        <button type="button" className="settings-shortcuts-button" onClick={resetAll}>
          {t("shortcuts.resetAll")}
        </button>
      </div>
    </div>
  );
}
