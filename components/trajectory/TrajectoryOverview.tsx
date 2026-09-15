"use client";

import type { TrajectoryRecord, TrajectoryTurn } from "@/lib/trajectory/types";
import { useI18n } from "@/hooks/useI18n";

interface Props {
  turns: TrajectoryTurn[];
  liveRecords: TrajectoryRecord[];
  selectedId: string | null;
  onSelectTurn: (turn: TrajectoryTurn) => void;
  onSelectLive: () => void;
}

function statusColor(status: TrajectoryRecord["status"]): string {
  if (status === "error") return "var(--trajectory-error)";
  if (status === "running") return "var(--accent)";
  if (status === "unknown") return "var(--text-dim)";
  return "var(--text-muted)";
}

function turnStatus(turn: TrajectoryTurn): TrajectoryRecord["status"] {
  if (turn.records.some((record) => record.status === "error")) return "error";
  if (turn.records.some((record) => record.status === "running")) return "running";
  if (turn.records.some((record) => record.status === "unknown")) return "unknown";
  return "complete";
}

export function TrajectoryOverview({ turns, liveRecords, selectedId, onSelectTurn, onSelectLive }: Props) {
  const { t } = useI18n();
  const liveTurn = liveRecords.length > 0 ? {
    id: "turn:live",
    records: liveRecords,
  } as TrajectoryTurn : null;

  return (
    <section
      data-trajectory-overview="true"
      aria-labelledby="trajectory-overview-heading"
      style={{
        padding: "10px 16px 12px",
        borderBottom: "1px solid var(--border)",
        background: "color-mix(in srgb, var(--bg-panel) 92%, var(--bg))",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <h2 id="trajectory-overview-heading" style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
          {t("trajectory.overview")}
        </h2>
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {t("trajectory.turnCount", { count: turns.length })}
        </span>
      </div>
      <div role="list" aria-label={t("trajectory.overview")} style={{ display: "flex", gap: 4, overflowX: "auto", paddingTop: 9, minHeight: 28 }}>
        {turns.map((turn, index) => {
          const status = turnStatus(turn);
          const selected = turn.records.some((record) => record.id === selectedId);
          return (
            <div key={turn.id} role="listitem" style={{ flex: "0 0 auto" }}>
              <button
                type="button"
                aria-label={`${t("trajectory.turnCount", { count: index + 1 })} · ${t(`trajectory.${status === "error" ? "errorStatus" : status === "running" ? "running" : status === "unknown" ? "unknown" : "complete"}`)}`}
              aria-pressed={selected}
              onClick={() => onSelectTurn(turn)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  minWidth: 30,
                height: 24,
                padding: "0 6px",
                border: `1px solid ${selected ? (status === "error" ? "var(--trajectory-error)" : "var(--accent)") : "var(--border)"}`,
                borderRadius: 4,
                background: selected ? "var(--bg-selected)" : "var(--bg-panel)",
                color: statusColor(status),
                cursor: "pointer",
                fontSize: 11,
              }}
              >
                <span aria-hidden="true" style={{ width: 5, height: 12, borderRadius: 2, background: statusColor(status) }} />
                <span>{index + 1}</span>
              </button>
            </div>
          );
        })}
        {liveTurn && (
          <div role="listitem" style={{ flex: "0 0 auto" }}>
            <button
              type="button"
              aria-label={t("trajectory.live")}
            aria-pressed={liveRecords.some((record) => record.id === selectedId)}
            onClick={onSelectLive}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                height: 24,
              padding: "0 7px",
              border: "1px solid var(--accent)",
              borderRadius: 4,
              background: "var(--bg-selected)",
              color: "var(--accent)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
            }}
            >
              <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)" }} />
              {t("trajectory.live")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
