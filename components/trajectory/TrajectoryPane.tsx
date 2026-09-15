"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import type { AgentPhase } from "@/hooks/useAgentSession";
import type { StreamingState } from "@/lib/streaming-message";
import type { TrajectoryRecord } from "@/lib/trajectory/types";
import type { TrajectorySearchMatch } from "@/lib/trajectory/search";
import { isInspectableTrajectoryRecord } from "@/lib/trajectory/selection";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useTrajectory, type UseTrajectoryResult } from "@/hooks/useTrajectory";
import { useTrajectorySearch } from "@/hooks/useTrajectorySearch";
import { TrajectoryInspector } from "./TrajectoryInspector";
import { TrajectoryLedger } from "./TrajectoryLedger";
import { TrajectoryOverview } from "./TrajectoryOverview";
import { TrajectorySearch } from "./TrajectorySearch";

export interface TrajectoryPaneProps {
  session: SessionInfo | null;
  activeLeafId: string | null;
  enabled: boolean;
  agentRunning: boolean;
  bashRunning: boolean;
  pendingBash: { command: string; excludeFromContext: boolean } | null;
  isCompacting: boolean;
  agentPhase: AgentPhase;
  streamState: StreamingState;
  onJumpToChat?: (target: { entryId: string; toolCallId?: string }) => void;
}

function InspectorPanel({ session, activeLeafId, trajectory, record, onClose, onJumpToChat }: {
  session: SessionInfo;
  activeLeafId: string | null;
  trajectory: UseTrajectoryResult;
  record: TrajectoryRecord;
  onClose: () => void;
  onJumpToChat: () => void;
}) {
  return (
    <TrajectoryInspector
      sessionId={session.id}
      activeLeafId={activeLeafId}
      record={record}
      detail={trajectory.detail}
      loading={trajectory.detailLoading}
      error={trajectory.detailError}
      onClose={onClose}
      onJumpToChat={onJumpToChat}
    />
  );
}

export function TrajectoryPane(props: TrajectoryPaneProps) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const trajectory = useTrajectory(props);
  const ledgerScrollRef = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingScrollRecordId, setPendingScrollRecordId] = useState<string | null>(null);
  const search = useTrajectorySearch({
    sessionId: props.session?.id ?? null,
    activeLeafId: props.activeLeafId,
    enabled: props.enabled,
    open: searchOpen,
  });

  useEffect(() => {
    if (!props.enabled) setSearchOpen(false);
  }, [props.enabled]);

  // The anchored page renders after `ensureTurnLoaded` resolves; waiting on the
  // page state keeps the scroll target stable after the new turns commit.
  useEffect(() => {
    if (!pendingScrollRecordId) return;
    const container = ledgerScrollRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(
      `[data-trajectory-record="${CSS.escape(pendingScrollRecordId)}"]`,
    );
    if (!target) return;
    const targetTop = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTo({ top: Math.max(0, targetTop - 24), behavior: "smooth" });
    target.animate([
      { backgroundColor: "var(--bg-selected)" },
      { backgroundColor: "transparent" },
    ], { duration: 2000 });
    setPendingScrollRecordId(null);
  }, [pendingScrollRecordId, trajectory.page]);

  const onJumpToChat = props.onJumpToChat;
  const jumpToChat = useCallback((record: TrajectoryRecord | null) => {
    if (!record || !onJumpToChat || record.id.startsWith("live:")) return;
    onJumpToChat({
      entryId: record.entryId,
      ...(record.toolCallId ? { toolCallId: record.toolCallId } : {}),
    });
  }, [onJumpToChat]);

  // Enter jumps to the selected record's chat position when focus is not in a
  // form control; the composer and search input keep their own Enter behavior.
  useEffect(() => {
    if (!props.enabled || !trajectory.selectedRecord) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.defaultPrevented || event.isComposing) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='combobox']")) return;
      const recordButton = target?.closest<HTMLElement>("[data-trajectory-record]");
      if (recordButton) {
        if (recordButton.dataset.trajectoryRecord !== trajectory.selectedRecord?.id) return;
      } else if (target?.closest("a, button")) {
        return;
      }
      event.preventDefault();
      jumpToChat(trajectory.selectedRecord);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [jumpToChat, props.enabled, trajectory.selectedRecord]);

  if (!props.enabled) return null;

  const { page, liveRecords, selectedRecord } = trajectory;
  const session = props.session;

  if (!session) {
    return (
      <section data-trajectory-pane="true" role="region" aria-labelledby="trajectory-title" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0, height: "100%", padding: 24, color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>
        <div>
          <h1 id="trajectory-title" style={{ margin: "0 0 8px", color: "var(--text)", fontSize: 16 }}>{t("trajectory.title")}</h1>
          <p style={{ margin: 0 }}>{t("trajectory.unsaved")}</p>
        </div>
      </section>
    );
  }

  const turns = page?.turns ?? [];
  const stats = page?.branchStats;
  const inspectorRecord = selectedRecord && isInspectableTrajectoryRecord(selectedRecord)
    ? selectedRecord
    : null;
  const selectRecord = (record: Parameters<typeof trajectory.selectRecord>[0]) => {
    const nextRecord = record && selectedRecord?.id === record.id ? null : record;
    void trajectory.selectRecord(nextRecord);
  };
  const selectMatch = async (match: TrajectorySearchMatch) => {
    const loaded = await trajectory.ensureTurnLoaded(match.record.turnId);
    if (!loaded) return;
    void trajectory.selectRecord(match.record);
    setPendingScrollRecordId(match.record.id);
  };
  const scrollToTurn = (turnId: string) => {
    requestAnimationFrame(() => {
      const container = ledgerScrollRef.current;
      if (!container) return;
      const target = Array.from(container.querySelectorAll<HTMLElement>("[data-trajectory-turn]"))
        .find((element) => element.dataset.trajectoryTurn === turnId);
      if (!target) return;
      const targetTop = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      container.scrollTo({ top: Math.max(0, targetTop - 8), behavior: "smooth" });
    });
  };

  return (
    <section
      data-trajectory-pane="true"
      role="region"
      aria-labelledby="trajectory-title"
      aria-busy={trajectory.loading}
      style={{ position: "relative", display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0, height: "100%", background: "var(--bg)" }}
    >
      <header style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 44, padding: "0 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
        {searchOpen ? (
          <TrajectorySearch
            query={search.query}
            onQueryChange={search.setQuery}
            type={search.type}
            onTypeChange={search.setType}
            results={search.results}
            total={search.total}
            truncated={search.truncated}
            loading={search.loading}
            error={search.error}
            onSelectMatch={(match) => void selectMatch(match)}
            onClose={() => setSearchOpen(false)}
          />
        ) : (
          <>
            <div style={{ minWidth: 0 }}>
              <h1 id="trajectory-title" style={{ margin: 0, overflow: "hidden", color: "var(--text)", fontSize: 14, fontWeight: 650, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("trajectory.title")}</h1>
              {stats && <div style={{ marginTop: 2, color: "var(--text-dim)", fontSize: 11 }}>{t("trajectory.recordCount", { count: stats.records })}</div>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              {page?.hasLater && (
                <button type="button" onClick={() => void trajectory.reload()} title={t("trajectory.latest")} aria-label={t("trajectory.latest")} style={{ height: 30, padding: "0 8px", border: "1px solid var(--border)", borderRadius: 4, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}>{t("trajectory.latest")}</button>
              )}
              <button type="button" onClick={() => setSearchOpen(true)} title={t("trajectory.search")} aria-label={t("trajectory.search")} style={{ flexShrink: 0, width: 30, height: 30, border: "1px solid var(--border)", borderRadius: 4, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 14 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              </button>
              <button type="button" onClick={() => void trajectory.reload()} disabled={trajectory.loading} title={t("trajectory.retry")} aria-label={t("trajectory.retry")} style={{ flexShrink: 0, width: 30, height: 30, border: "1px solid var(--border)", borderRadius: 4, background: "transparent", color: "var(--text-muted)", cursor: trajectory.loading ? "wait" : "pointer", fontSize: 15 }}>↻</button>
            </div>
          </>
        )}
      </header>

      {trajectory.error && (
        <div role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 16px", borderBottom: "1px solid var(--border)", color: "var(--text)", fontSize: 12 }}>
          <span>{trajectory.error || t("trajectory.error")}</span>
          <button type="button" onClick={() => void trajectory.reload()} style={{ border: "1px solid var(--border)", borderRadius: 4, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}>{t("trajectory.retry")}</button>
        </div>
      )}
      {trajectory.loading && !page && (
        <div role="status" style={{ padding: 18, color: "var(--text-muted)", fontSize: 12 }}>{t("trajectory.loading")}</div>
      )}

      <TrajectoryOverview turns={turns} liveRecords={liveRecords} selectedId={selectedRecord?.id ?? null} onSelectTurn={(turn) => scrollToTurn(turn.id)} onSelectLive={() => scrollToTurn("turn:live")} />
      <div style={{ display: "grid", gridTemplateColumns: isMobile || !inspectorRecord ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(300px, 38%)", flex: 1, minHeight: 0 }}>
        <div ref={ledgerScrollRef} style={{ minWidth: 0, minHeight: 0, overflow: "auto" }}>
          <TrajectoryLedger
            turns={turns}
            liveRecords={liveRecords}
            selectedId={selectedRecord?.id ?? null}
            hasEarlier={page?.hasEarlier ?? false}
            loadingEarlier={trajectory.loadingEarlier}
            onLoadEarlier={() => void trajectory.loadEarlier()}
            onSelect={selectRecord}
            onJump={jumpToChat}
          />
        </div>
        {!isMobile && inspectorRecord && <InspectorPanel session={session} activeLeafId={props.activeLeafId} trajectory={trajectory} record={inspectorRecord} onClose={() => selectRecord(null)} onJumpToChat={() => jumpToChat(inspectorRecord)} />}
      </div>

      {isMobile && inspectorRecord && (
        <div role="dialog" aria-modal="true" aria-labelledby="trajectory-inspector-heading" style={{ position: "absolute", inset: 0, zIndex: 5, overflow: "auto", background: "var(--bg-panel)", boxShadow: "-8px 0 24px rgba(0,0,0,0.18)" }}>
          <InspectorPanel session={session} activeLeafId={props.activeLeafId} trajectory={trajectory} record={inspectorRecord} onClose={() => selectRecord(null)} onJumpToChat={() => jumpToChat(inspectorRecord)} />
        </div>
      )}
    </section>
  );
}
