"use client";

import { useMemo } from "react";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";

interface Props {
  rootSession: SessionInfo;
  consultations: SessionInfo[];
  selectedSessionId: string;
  runningSessionIds: ReadonlySet<string>;
  onSelectSession: (session: SessionInfo) => void;
}

function sessionTitle(session: SessionInfo): string {
  return session.name?.trim() || session.firstMessage?.trim() || session.id;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

function secondaryLabel(session: SessionInfo, main: boolean, t: Translate): string {
  if (main) return sessionTitle(session);
  const relation = session.relation?.kind === "consultation" ? session.relation : null;
  if (relation?.contextMode === "turn") return t("consultation.currentTurn");
  return t("consultation.selectionOnly");
}

export function ConsultationSessionPanel({
  rootSession,
  consultations,
  selectedSessionId,
  runningSessionIds,
  onSelectSession,
}: Props) {
  const { t } = useI18n();
  const sorted = useMemo(
    () => [...consultations].sort((a, b) => b.modified.localeCompare(a.modified)),
    [consultations],
  );
  return (
    <div
      role="listbox"
      aria-label={t("consultation.title")}
      style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderTop: "none",
        boxShadow: "0 10px 28px rgba(0,0,0,0.12)",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 12, fontWeight: 650, color: "var(--text)" }}>{t("consultation.title")}</div>
        <div style={{ marginTop: 3, color: "var(--text-dim)", fontSize: 11 }}>
          {t("consultation.count", { count: consultations.length })}
        </div>
      </div>
      <ConsultationRow
        session={rootSession}
        main
        selected={rootSession.id === selectedSessionId}
        running={runningSessionIds.has(rootSession.id)}
        onSelect={() => onSelectSession(rootSession)}
        t={t}
      />
      {sorted.map((session) => (
        <ConsultationRow
          key={session.id}
          session={session}
          selected={session.id === selectedSessionId}
          running={runningSessionIds.has(session.id)}
          onSelect={() => onSelectSession(session)}
          t={t}
        />
      ))}
    </div>
  );
}

function ConsultationRow({
  session,
  main,
  selected,
  running,
  onSelect,
  t,
}: {
  session: SessionInfo;
  main?: boolean;
  selected: boolean;
  running: boolean;
  onSelect: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const title = main ? t("consultation.parent") : sessionTitle(session);
  const secondary = secondaryLabel(session, Boolean(main), t);
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        width: "100%",
        minHeight: 48,
        padding: "7px 12px",
        border: "none",
        borderBottom: "1px solid var(--border)",
        background: selected ? "var(--bg-selected)" : "transparent",
        color: "var(--text)",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: running ? "var(--accent)" : "var(--text-dim)", flexShrink: 0 }} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: main ? 600 : 500 }}>
          {title}
        </span>
        <span style={{ display: "block", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: 10 }}>
          {secondary}
        </span>
      </span>
      {!main && <span style={{ color: "var(--text-dim)", fontSize: 10 }}>↗</span>}
    </button>
  );
}
