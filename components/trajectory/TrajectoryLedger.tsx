"use client";

import { useCallback, useState } from "react";
import type { TrajectoryRecord, TrajectoryTurn } from "@/lib/trajectory/types";
import { groupTrajectoryRuns, type TrajectoryRunGroup } from "@/lib/trajectory/runs";
import { TRAJECTORY_KIND_LABEL_KEYS } from "@/lib/trajectory/labels";
import { useI18n } from "@/hooks/useI18n";

interface Props {
  turns: TrajectoryTurn[];
  liveRecords: TrajectoryRecord[];
  selectedId: string | null;
  hasEarlier: boolean;
  loadingEarlier: boolean;
  onLoadEarlier: () => void;
  onSelect: (record: TrajectoryRecord) => void;
  onJump?: (record: TrajectoryRecord) => void;
}

function statusKey(status: TrajectoryRecord["status"]): string {
  if (status === "error") return "trajectory.errorStatus";
  if (status === "running") return "trajectory.running";
  if (status === "unknown") return "trajectory.unknown";
  return "trajectory.complete";
}

function formatDuration(durationMs: number | undefined): string | null {
  if (durationMs === undefined) return null;
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
}

function assistantMetadata(record: TrajectoryRecord, t: (key: string, params?: Record<string, string | number>) => string): string {
  const parts: string[] = [];
  if (record.stopReason && record.stopReason !== "stop" && record.stopReason !== "toolUse") {
    parts.push(t("trajectory.stopReason", { reason: record.stopReason }));
  }
  if (record.toolCallCount !== undefined) parts.push(t("trajectory.toolsCount", { count: record.toolCallCount }));
  if (record.usage) {
    const tokens = record.usage.input + record.usage.output + record.usage.cacheRead + record.usage.cacheWrite;
    parts.push(t("trajectory.tokensCount", { count: tokens.toLocaleString() }));
  }
  if (record.timestamp) {
    const time = record.timestamp.match(/T(\d{2}:\d{2}:\d{2})/u)?.[1];
    if (time) parts.push(time);
  }
  return parts.join(" · ");
}

function recordPreview(record: TrajectoryRecord, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (record.kind === "assistant") return assistantMetadata(record, t) || "—";
  return record.preview ?? record.summary;
}

function statusColor(status: TrajectoryRecord["status"]): string {
  if (status === "error") return "var(--trajectory-error)";
  if (status === "running") return "var(--accent)";
  if (status === "unknown") return "var(--text-dim)";
  return "var(--text-muted)";
}

function RecordButton({ record, selectedId, onSelect, onJump, t }: {
  record: TrajectoryRecord;
  selectedId: string | null;
  onSelect: (record: TrajectoryRecord) => void;
  onJump?: (record: TrajectoryRecord) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const selected = selectedId === record.id;
  const duration = formatDuration(record.durationMs);
  const preview = recordPreview(record, t);
  const label = [
    t(TRAJECTORY_KIND_LABEL_KEYS[record.kind]),
    preview,
    t(statusKey(record.status)),
    duration,
  ].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      data-trajectory-record={record.id}
      data-trajectory-kind={record.kind}
      data-trajectory-status={record.status}
      aria-label={label}
      aria-pressed={selected}
      onClick={() => onSelect(record)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (selected && onJump) onJump(record);
          else onSelect(record);
          return;
        }
        if (event.key === " ") {
          event.preventDefault();
          onSelect(record);
        }
      }}
      style={{
        display: "grid",
        gridTemplateColumns: "7px minmax(0, 1fr) auto",
        gap: 9,
        alignItems: "center",
        width: "100%",
        minHeight: 36,
        padding: "7px 10px",
        border: `1px solid ${selected ? "var(--trajectory-kind-color, var(--accent))" : "transparent"}`,
        borderRadius: 5,
        background: selected ? "var(--bg-selected)" : record.status === "error" ? "var(--trajectory-error-bg)" : "transparent",
        boxShadow: selected ? "inset 3px 0 var(--trajectory-kind-color, var(--accent))" : "none",
        color: "var(--text)",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span aria-hidden="true" style={{ width: 4, minHeight: 20, alignSelf: "stretch", borderRadius: 2, background: "var(--trajectory-kind-color, var(--text-muted))" }} />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0, lineHeight: 1.35 }}>
          <span style={{ color: "var(--trajectory-kind-color, var(--text-muted))", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", flexShrink: 0 }}>
            {t(TRAJECTORY_KIND_LABEL_KEYS[record.kind])}
          </span>
          <span style={{ minWidth: 0, overflow: "hidden", color: "var(--text-muted)", fontSize: 12, fontWeight: 500, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {preview}
          </span>
        </span>
        {record.status === "error" && record.error && (
          <span style={{ display: "block", marginTop: 3, overflow: "hidden", color: "var(--trajectory-error)", fontSize: 11, lineHeight: 1.35, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {record.error}
          </span>
        )}
      </span>
      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, color: statusColor(record.status), fontSize: 10, whiteSpace: "nowrap" }}>
        <span>{t(statusKey(record.status))}</span>
        {duration && <span style={{ color: "var(--text-dim)" }}>{duration}</span>}
      </span>
    </button>
  );
}

function RunGroup({ group, collapsed, onToggle, selectedId, onSelect, onJump, t }: {
  group: Extract<TrajectoryRunGroup, { type: "run" }>;
  collapsed: boolean;
  onToggle: () => void;
  selectedId: string | null;
  onSelect: (record: TrajectoryRecord) => void;
  onJump?: (record: TrajectoryRecord) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const root = group.records[0];
  if (!root) return null;
  return (
    <div data-trajectory-run={group.id} data-trajectory-run-status={group.status} style={{ marginBottom: 5 }}>
      <div style={{ display: "grid", gridTemplateColumns: "20px minmax(0, 1fr)", gap: 2, alignItems: "center" }}>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("trajectory.expandRun") : t("trajectory.collapseRun")}
          title={collapsed ? t("trajectory.expandRun") : t("trajectory.collapseRun")}
          onClick={onToggle}
          style={{ width: 20, height: 24, padding: 0, border: "none", background: "transparent", color: "var(--text-dim)", cursor: "pointer", fontSize: 13 }}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <RecordButton record={root} selectedId={selectedId} onSelect={onSelect} onJump={onJump} t={t} />
      </div>
      {!collapsed && group.records.length > 1 && (
        <div style={{ marginLeft: 20, paddingLeft: 7, borderLeft: "1px solid var(--border)", display: "grid", gap: 5 }}>
          {group.records.slice(1).map((record) => (
            <RecordButton key={record.id} record={record} selectedId={selectedId} onSelect={onSelect} onJump={onJump} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TrajectoryLedger({ turns, liveRecords, selectedId, hasEarlier, loadingEarlier, onLoadEarlier, onSelect, onJump }: Props) {
  const { t } = useI18n();
  const [collapsedRunIds, setCollapsedRunIds] = useState<Set<string>>(() => new Set());
  const toggleRun = useCallback((runId: string) => {
    setCollapsedRunIds((previous) => {
      const next = new Set(previous);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }, []);
  const renderRecords = (records: TrajectoryRecord[]) => groupTrajectoryRuns(records).map((group) => (
    group.type === "run" ? (
      <RunGroup
        key={group.id}
        group={group}
        collapsed={collapsedRunIds.has(group.id)}
        onToggle={() => toggleRun(group.id)}
        selectedId={selectedId}
        onSelect={onSelect}
        onJump={onJump}
        t={t}
      />
    ) : <RecordButton key={group.record.id} record={group.record} selectedId={selectedId} onSelect={onSelect} onJump={onJump} t={t} />
  ));

  return (
    <section data-trajectory-ledger="true" aria-labelledby="trajectory-ledger-heading" style={{ minWidth: 0, padding: "14px 16px 28px" }}>
      <h2 id="trajectory-ledger-heading" style={{ margin: "0 0 10px", fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
        {t("trajectory.ledger")}
      </h2>
      {hasEarlier && (
        <button type="button" onClick={onLoadEarlier} disabled={loadingEarlier} style={{ width: "100%", marginBottom: 10, padding: "7px 10px", border: "1px dashed var(--border)", borderRadius: 5, background: "transparent", color: "var(--text-muted)", cursor: loadingEarlier ? "wait" : "pointer", fontSize: 12 }}>
          {loadingEarlier ? t("trajectory.loading") : t("trajectory.loadEarlier")}
        </button>
      )}
      {turns.length === 0 && liveRecords.length === 0 ? (
        <div role="status" style={{ padding: "28px 8px", color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>{t("trajectory.empty")}</div>
      ) : (
        <div>
          {turns.map((turn, index) => (
            <article key={turn.id} data-trajectory-turn={turn.id} style={{ marginBottom: 12 }}>
              <h3 style={{ margin: "0 0 5px 2px", color: "var(--text-dim)", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                {t("trajectory.turnCount", { count: index + 1 })}
                {turn.durationMs !== undefined && <span style={{ marginLeft: 7, fontWeight: 400 }}>{formatDuration(turn.durationMs)}</span>}
              </h3>
              <div style={{ borderLeft: "1px solid var(--border)", paddingLeft: 7 }}>{renderRecords(turn.records)}</div>
            </article>
          ))}
          {liveRecords.length > 0 && (
            <article data-trajectory-turn="turn:live" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: "0 0 5px 2px", color: "var(--accent)", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>{t("trajectory.live")}</h3>
              <div style={{ borderLeft: "1px solid var(--accent)", paddingLeft: 7 }}>{renderRecords(liveRecords)}</div>
            </article>
          )}
        </div>
      )}
    </section>
  );
}

export { formatDuration };
