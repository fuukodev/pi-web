"use client";

import type { TrajectoryRecord } from "@/lib/trajectory/types";
import type { TrajectoryRecordDetail } from "@/lib/trajectory/detail";
import { useI18n } from "@/hooks/useI18n";

interface Props {
  sessionId: string;
  activeLeafId: string | null;
  record: TrajectoryRecord | null;
  detail: TrajectoryRecordDetail | null;
  loading: boolean;
  error: string | null;
  onClose?: () => void;
}

function jsonText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return "[unavailable]";
  }
}

function durationLabel(record: TrajectoryRecord, t: (key: string) => string): string {
  if (record.durationMs === undefined) return t("trajectory.notAvailable");
  const value = record.durationMs < 1000
    ? `${record.durationMs} ms`
    : `${(record.durationMs / 1000).toFixed(record.durationMs < 10_000 ? 1 : 0)} s`;
  const source = record.durationSource === "live"
    ? t("trajectory.liveDuration")
    : record.durationSource === "estimated"
      ? t("trajectory.estimated")
      : t("trajectory.unknown");
  return `${value} (${source})`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 16 }}>
      <h3 style={{ margin: "0 0 6px", color: "var(--text-muted)", fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>{title}</h3>
      {children}
    </section>
  );
}

export function TrajectoryInspector({ sessionId, activeLeafId, record, detail, loading, error, onClose }: Props) {
  const { t } = useI18n();
  if (!record) {
    return (
      <aside data-trajectory-inspector="true" role="complementary" aria-label={t("trajectory.inspector")} style={{ minWidth: 0, padding: 16, color: "var(--text-dim)", fontSize: 12 }}>
        {t("trajectory.selectRecord")}
      </aside>
    );
  }

  const params = new URLSearchParams({ inline: "1", targetId: record.entryId });
  if (activeLeafId) params.set("leafId", activeLeafId);
  const historyHref = `/api/sessions/${encodeURIComponent(sessionId)}/export?${params}`;
  const payload = detail?.entry.message?.content ?? detail?.entry.message ?? detail?.entry;
  const result = detail?.result?.message?.content ?? detail?.result;

  return (
    <aside data-trajectory-inspector="true" role="complementary" aria-labelledby="trajectory-inspector-heading" style={{ minWidth: 0, height: "100%", overflow: "auto", padding: 16, borderLeft: "1px solid var(--border)", background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h2 id="trajectory-inspector-heading" style={{ margin: 0, overflow: "hidden", color: "var(--text)", fontSize: 14, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{record.summary}</h2>
          <div style={{ marginTop: 4, color: "var(--text-dim)", fontSize: 11 }}>{t(`trajectory.${record.kind === "branchSummary" ? "branchSummary" : record.kind}`)}</div>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label={t("trajectory.closeInspector")} title={t("trajectory.closeInspector")} style={{ flexShrink: 0, width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 4, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 16 }}>×</button>
        )}
      </div>

      <Section title={t("trajectory.summary")}>
        <div style={{ color: "var(--text)", fontSize: 12, lineHeight: 1.5 }}>{record.preview ?? t("trajectory.notAvailable")}</div>
        <dl style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "5px 10px", margin: "10px 0 0", color: "var(--text-muted)", fontSize: 11 }}>
          <dt>{t("trajectory.source")}</dt><dd style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{record.entryId}</dd>
          <dt>{t("trajectory.timing")}</dt><dd style={{ margin: 0 }}>{durationLabel(record, t)}</dd>
        </dl>
      </Section>

      {loading && <div role="status" style={{ marginTop: 16, color: "var(--text-muted)", fontSize: 12 }}>{t("trajectory.loadingDetails")}</div>}
      {error && <div role="alert" style={{ marginTop: 16, color: "var(--text)", fontSize: 12 }}>{error}</div>}
      {!loading && !error && record.id.startsWith("live:") && (
        <div role="status" style={{ marginTop: 16, color: "var(--accent)", fontSize: 12 }}>{t("trajectory.live")}</div>
      )}

      {!loading && !error && detail && (
        <>
          <Section title={t("trajectory.payload")}>
            <pre style={{ maxHeight: 280, overflow: "auto", margin: 0, padding: 9, border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg)", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11, lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{jsonText(payload)}</pre>
          </Section>
          <Section title={t("trajectory.result")}>
            {result ? <pre style={{ maxHeight: 280, overflow: "auto", margin: 0, padding: 9, border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg)", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11, lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{jsonText(result)}</pre> : <div style={{ color: "var(--text-dim)", fontSize: 12 }}>{t("trajectory.notAvailable")}</div>}
          </Section>
          <Section title={t("trajectory.schema")}>
            <div style={{ color: "var(--text-dim)", fontSize: 12 }}>{t("trajectory.notAvailable")}</div>
          </Section>
        </>
      )}

      <a href={historyHref} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", marginTop: 18, color: "var(--accent)", fontSize: 12, textDecoration: "none" }}>
        {t("history.full")} ↗
      </a>
    </aside>
  );
}
