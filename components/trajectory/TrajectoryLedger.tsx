"use client";

import type { TrajectoryRecord, TrajectoryTurn } from "@/lib/trajectory/types";
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
  const label = [
    t(TRAJECTORY_KIND_LABEL_KEYS[record.kind]),
    record.summary,
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
          // Enter on the selected record jumps to its chat position; Enter on
          // another record selects it without stealing the native behavior.
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
        alignItems: "start",
        width: "100%",
        padding: "9px 10px",
        border: `1px solid ${selected ? "var(--trajectory-kind-color, var(--accent))" : "transparent"}`,
        borderRadius: 5,
        background: selected ? "var(--bg-selected)" : record.status === "error" ? "var(--trajectory-error-bg)" : "transparent",
        boxShadow: selected ? "inset 3px 0 var(--trajectory-kind-color, var(--accent))" : "none",
        color: "var(--text)",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span aria-hidden="true" style={{ width: 4, minHeight: 18, alignSelf: "stretch", borderRadius: 2, background: "var(--trajectory-kind-color, var(--text-muted))" }} />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
          <span style={{ color: "var(--trajectory-kind-color, var(--text-muted))", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", flexShrink: 0 }}>
            {t(TRAJECTORY_KIND_LABEL_KEYS[record.kind])}
          </span>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 600 }}>
            {record.summary}
          </span>
        </span>
        {record.preview && (
          <span style={{ display: "block", marginTop: 4, overflow: "hidden", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.4, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {record.preview}
          </span>
        )}
        {record.status === "error" && record.error && (
          <span style={{ display: "block", marginTop: 3, overflow: "hidden", color: "var(--trajectory-error)", fontSize: 11, lineHeight: 1.4, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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

export function TrajectoryLedger({ turns, liveRecords, selectedId, hasEarlier, loadingEarlier, onLoadEarlier, onSelect, onJump }: Props) {
  const { t } = useI18n();
  return (
    <section data-trajectory-ledger="true" aria-labelledby="trajectory-ledger-heading" style={{ minWidth: 0, padding: "14px 16px 28px" }}>
      <h2 id="trajectory-ledger-heading" style={{ margin: "0 0 10px", fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
        {t("trajectory.ledger")}
      </h2>
      {hasEarlier && (
        <button
          type="button"
          onClick={onLoadEarlier}
          disabled={loadingEarlier}
          style={{ width: "100%", marginBottom: 10, padding: "7px 10px", border: "1px dashed var(--border)", borderRadius: 5, background: "transparent", color: "var(--text-muted)", cursor: loadingEarlier ? "wait" : "pointer", fontSize: 12 }}
        >
          {loadingEarlier ? t("trajectory.loading") : t("trajectory.loadEarlier")}
        </button>
      )}
      {turns.length === 0 && liveRecords.length === 0 ? (
        <div role="status" style={{ padding: "28px 8px", color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>
          {t("trajectory.empty")}
        </div>
      ) : (
        <div>
          {turns.map((turn, index) => (
            <article key={turn.id} data-trajectory-turn={turn.id} style={{ marginBottom: 12 }}>
              <h3 style={{ margin: "0 0 3px 2px", color: "var(--text-dim)", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                {t("trajectory.turnCount", { count: index + 1 })}
                {turn.durationMs !== undefined && <span style={{ marginLeft: 7, fontWeight: 400 }}>{formatDuration(turn.durationMs)}</span>}
              </h3>
              <div style={{ borderLeft: "1px solid var(--border)", paddingLeft: 7 }}>
                {turn.records.map((record) => (
                  <RecordButton key={record.id} record={record} selectedId={selectedId} onSelect={onSelect} onJump={onJump} t={t} />
                ))}
              </div>
            </article>
          ))}
          {liveRecords.length > 0 && (
            <article data-trajectory-turn="turn:live" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: "0 0 3px 2px", color: "var(--accent)", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                {t("trajectory.live")}
              </h3>
              <div style={{ borderLeft: "1px solid var(--accent)", paddingLeft: 7 }}>
                {liveRecords.map((record) => (
                  <RecordButton key={record.id} record={record} selectedId={selectedId} onSelect={onSelect} onJump={onJump} t={t} />
                ))}
              </div>
            </article>
          )}
        </div>
      )}
    </section>
  );
}

export { formatDuration };
