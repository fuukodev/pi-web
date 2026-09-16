"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseTrajectorySearchQuery,
  type TrajectorySearchField,
  type TrajectorySearchMatch,
  type TrajectorySearchType,
} from "@/lib/trajectory/search-query";
import { TRAJECTORY_KIND_LABEL_KEYS } from "@/lib/trajectory/labels";
import { useI18n } from "@/hooks/useI18n";

export type TrajectorySearchScope = TrajectorySearchType | "all";

const TYPE_OPTIONS: readonly TrajectorySearchScope[] = ["all", "user", "assistant", "thinking", "tool"];

interface Props {
  query: string;
  onQueryChange: (value: string) => void;
  type: TrajectorySearchScope;
  onTypeChange: (type: TrajectorySearchScope) => void;
  results: TrajectorySearchMatch[];
  total: number;
  truncated: boolean;
  loading: boolean;
  error: string | null;
  onSelectMatch: (match: TrajectorySearchMatch) => void;
  onClose: () => void;
}

interface HighlightPart {
  text: string;
  match: boolean;
}

function highlight(text: string, term: string): HighlightPart[] {
  if (!term) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  const parts: HighlightPart[] = [];
  let index = 0;
  while (index <= text.length) {
    const found = lower.indexOf(needle, index);
    if (found < 0) {
      if (index < text.length) parts.push({ text: text.slice(index), match: false });
      break;
    }
    if (found > index) parts.push({ text: text.slice(index, found), match: false });
    parts.push({ text: text.slice(found, found + needle.length), match: true });
    index = found + needle.length;
  }
  return parts;
}

function fieldKey(field: TrajectorySearchField): string | null {
  return field === "thinking" ? "trajectory.searchFieldThinking" : null;
}

export function TrajectorySearch({
  query,
  onQueryChange,
  type,
  onTypeChange,
  results,
  total,
  truncated,
  loading,
  error,
  onSelectMatch,
  onClose,
}: Props) {
  const { t } = useI18n();
  const [typeOpen, setTypeOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const typeRef = useRef<HTMLDivElement>(null);
  const typeButtonRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const term = useMemo(() => parseTrajectorySearchQuery(query).term, [query]);
  const open = Boolean(term);
  const scopeLabel = type === "all"
    ? t("trajectory.searchAllTypes")
    : t(TRAJECTORY_KIND_LABEL_KEYS[type]);

  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`trajectory-search-result-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  useEffect(() => {
    if (!typeOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!typeRef.current?.contains(event.target as Node)) setTypeOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [typeOpen]);

  useEffect(() => {
    if (typeOpen) optionRefs.current[TYPE_OPTIONS.indexOf(type)]?.focus();
  }, [typeOpen, type]);

  const moveTypeFocus = (step: number) => {
    const current = TYPE_OPTIONS.indexOf(type);
    const next = (current + step + TYPE_OPTIONS.length) % TYPE_OPTIONS.length;
    optionRefs.current[next]?.focus();
    onTypeChange(TYPE_OPTIONS[next]);
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (typeOpen) setTypeOpen(false);
      else onClose();
      return;
    }
    if (event.key === "ArrowDown" && results.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => Math.min(results.length - 1, index + 1));
      return;
    }
    if (event.key === "ArrowUp" && results.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === "Enter" && open && results[activeIndex]) {
      event.preventDefault();
      onSelectMatch(results[activeIndex]);
    }
  };

  const statusText = loading
    ? t("trajectory.searching")
    : error
      ? error
      : !open
        ? ""
        : total === 0
          ? t("trajectory.searchNoResults")
          : t("trajectory.searchResults", { count: total });

  return (
    <>
      <span
        id="trajectory-search-hint"
        style={{ position: "absolute", width: 1, height: 1, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}
      >
        {t("trajectory.searchHint")}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
        <div ref={typeRef} style={{ position: "relative", flexShrink: 0 }}>
          <button
            ref={typeButtonRef}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={typeOpen}
            aria-label={t("trajectory.searchTypeLabel")}
            title={t("trajectory.searchHint")}
            onClick={() => setTypeOpen((value) => !value)}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 28, padding: "0 8px", border: "1px solid var(--border)", borderRadius: 4, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}
          >
            {scopeLabel}
            <span aria-hidden="true">▾</span>
          </button>
          {typeOpen && (
            <div
              role="listbox"
              aria-label={t("trajectory.searchTypeLabel")}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setTypeOpen(false);
                  typeButtonRef.current?.focus();
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  moveTypeFocus(1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  moveTypeFocus(-1);
                }
              }}
              style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 30, minWidth: 140, padding: 4, border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg-panel)", boxShadow: "0 8px 24px rgba(0,0,0,0.18)" }}
            >
              {TYPE_OPTIONS.map((option, index) => (
                <button
                  key={option}
                  ref={(element) => { optionRefs.current[index] = element; }}
                  type="button"
                  role="option"
                  aria-selected={option === type}
                  onClick={() => {
                    onTypeChange(option);
                    setTypeOpen(false);
                    typeButtonRef.current?.focus();
                  }}
                  style={{ display: "block", width: "100%", padding: "6px 8px", border: "none", borderRadius: 4, background: option === type ? "var(--bg-selected)" : "transparent", color: "var(--text)", cursor: "pointer", fontSize: 12, textAlign: "left" }}
                >
                  {option === "all" ? t("trajectory.searchAllTypes") : t(TRAJECTORY_KIND_LABEL_KEYS[option])}
                </button>
              ))}
            </div>
          )}
        </div>

        <input
          autoFocus
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls="trajectory-search-results"
          aria-describedby="trajectory-search-hint"
          aria-activedescendant={open && results[activeIndex] ? `trajectory-search-result-${activeIndex}` : undefined}
          aria-label={t("trajectory.searchPlaceholder")}
          placeholder={t("trajectory.searchPlaceholder")}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={handleInputKeyDown}
          style={{ flex: 1, minWidth: 0, height: 28, padding: "0 8px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg)", color: "var(--text)", fontSize: 12 }}
        />

        <span
          role="status"
          style={{ flexShrink: 0, maxWidth: 200, overflow: "hidden", color: error ? "var(--trajectory-error)" : "var(--text-dim)", fontSize: 11, textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {statusText}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("trajectory.searchClose")}
          title={t("trajectory.searchClose")}
          style={{ flexShrink: 0, width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 4, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 15 }}
        >
          ×
        </button>
      </div>

      {open && (
        <div
          id="trajectory-search-results"
          role="listbox"
          aria-label={t("trajectory.searchPlaceholder")}
          style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, maxHeight: "45vh", overflow: "auto", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", boxShadow: "0 12px 28px rgba(0,0,0,0.18)" }}
        >
          {truncated && results.length > 0 && (
            <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 11 }}>
              {t("trajectory.searchTruncated", { count: results.length })}
            </div>
          )}
          {results.map((match, index) => {
            const badgeKey = fieldKey(match.field);
            return (
              <button
                key={`${match.record.id}-${match.field}`}
                id={`trajectory-search-result-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                data-trajectory-search-result={match.record.id}
                data-trajectory-kind={match.record.kind}
                data-trajectory-status={match.record.status}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => onSelectMatch(match)}
                style={{ display: "block", width: "100%", padding: "8px 12px", border: "none", borderBottom: "1px solid var(--border)", background: index === activeIndex ? "var(--bg-hover)" : match.record.status === "error" ? "var(--trajectory-error-bg)" : "transparent", color: "var(--text)", cursor: "pointer", textAlign: "left" }}
              >
                <span style={{ display: "flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
                  <span style={{ flexShrink: 0, color: "var(--trajectory-kind-color, var(--text-muted))", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    {t(TRAJECTORY_KIND_LABEL_KEYS[match.record.kind])}
                  </span>
                  <span style={{ minWidth: 0, overflow: "hidden", fontSize: 12, fontWeight: 600, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {match.record.preview ?? match.record.summary}
                  </span>
                  {badgeKey && (
                    <span style={{ flexShrink: 0, padding: "0 4px", border: "1px solid var(--border)", borderRadius: 3, color: "var(--text-dim)", fontSize: 10 }}>
                      {t(badgeKey)}
                    </span>
                  )}
                  {match.record.status === "error" && (
                    <span style={{ flexShrink: 0, padding: "0 4px", border: "1px solid var(--trajectory-error)", borderRadius: 3, color: "var(--trajectory-error)", fontSize: 10 }}>
                      {t("trajectory.errorStatus")}
                    </span>
                  )}
                  <span style={{ flexShrink: 0, marginLeft: "auto", color: "var(--text-dim)", fontSize: 10 }}>
                    {t("trajectory.turnCount", { count: match.turnOrdinal })}
                  </span>
                </span>
                <span style={{ display: "block", marginTop: 3, overflow: "hidden", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.4, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {highlight(match.snippet, term).map((part, partIndex) => (
                    part.match
                      ? <mark key={partIndex} style={{ padding: 0, background: "var(--bg-selected)", color: "var(--text)" }}>{part.text}</mark>
                      : <span key={partIndex}>{part.text}</span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
