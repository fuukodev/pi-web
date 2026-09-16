"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StreamingState } from "@/lib/streaming-message";
import type { SessionInfo, ToolResultMessage } from "@/lib/types";
import {
  buildLiveTrajectoryRecords,
  type LiveTrajectoryPhase,
  type LiveTrajectoryStarts,
} from "@/lib/trajectory/live";
import type {
  TrajectoryPage,
  TrajectoryRecord,
} from "@/lib/trajectory/types";
import { isInspectableTrajectoryRecord } from "@/lib/trajectory/selection";
import type { TrajectoryRecordDetail } from "@/lib/trajectory/detail";
import type { AgentPhase } from "./useAgentSession";

interface TrajectoryResponseError {
  error?: string;
}

export interface UseTrajectoryOptions {
  session: SessionInfo | null;
  activeLeafId: string | null;
  enabled: boolean;
  agentRunning: boolean;
  bashRunning: boolean;
  pendingBash: { command: string; excludeFromContext: boolean } | null;
  isCompacting: boolean;
  agentPhase: AgentPhase;
  streamState: StreamingState;
  activeToolResults: ReadonlyMap<string, ToolResultMessage>;
  liveUserMessage?: string | null;
  runError?: string | null;
  liveLoadingLabel?: string;
}

export interface UseTrajectoryResult {
  page: TrajectoryPage | null;
  loading: boolean;
  loadingEarlier: boolean;
  error: string | null;
  loadEarlier: () => Promise<void>;
  reload: (options?: { preserveView?: boolean }) => Promise<void>;
  ensureTurnLoaded: (turnId: string) => Promise<boolean>;
  liveRecords: TrajectoryRecord[];
  selectedRecord: TrajectoryRecord | null;
  detail: TrajectoryRecordDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  selectRecord: (record: TrajectoryRecord | null) => Promise<void>;
}

const DEFAULT_PAGE_LIMIT = 20;

function responseError(response: Response, data: TrajectoryResponseError): Error {
  return new Error(data.error ?? `HTTP ${response.status}`);
}

export function useTrajectory({
  session,
  activeLeafId,
  enabled,
  agentRunning,
  bashRunning,
  pendingBash,
  isCompacting,
  agentPhase,
  streamState,
  activeToolResults,
  liveUserMessage,
  runError,
  liveLoadingLabel,
}: UseTrajectoryOptions): UseTrajectoryResult {
  const sessionId = session?.id ?? null;
  const requestControllerRef = useRef<AbortController | null>(null);
  const detailControllerRef = useRef<AbortController | null>(null);
  const pageRef = useRef<TrajectoryPage | null>(null);
  const loadingEarlierRef = useRef(false);
  const startsRef = useRef<LiveTrajectoryStarts>({
    tools: new Map(),
  });
  const wasBusyRef = useRef(false);
  const [page, setPage] = useState<TrajectoryPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<TrajectoryRecord | null>(null);
  const selectedRecordRef = useRef<TrajectoryRecord | null>(null);
  const [detail, setDetail] = useState<TrajectoryRecordDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [liveNow, setLiveNow] = useState(() => Date.now());

  pageRef.current = page;
  selectedRecordRef.current = selectedRecord;

  const fetchPage = useCallback(async (cursor?: string | null, anchor?: string | null): Promise<TrajectoryPage | null> => {
    if (!enabled || !sessionId) return null;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const params = new URLSearchParams({ limit: String(DEFAULT_PAGE_LIMIT) });
    if (activeLeafId) params.set("leafId", activeLeafId);
    if (cursor) params.set("cursor", cursor);
    if (anchor) params.set("anchor", anchor);

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/trajectory?${params}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      const data = await response.json() as TrajectoryPage & TrajectoryResponseError;
      if (!response.ok) throw responseError(response, data);
      return data;
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
    }
  }, [activeLeafId, enabled, sessionId]);

  const reload = useCallback(async ({ preserveView = false, latest = false }: { preserveView?: boolean; latest?: boolean } = {}) => {
    if (!enabled || !sessionId) return;
    setLoading(true);
    setError(null);
    if (!preserveView) {
      setPage(null);
      setSelectedRecord(null);
      setDetail(null);
    }
    try {
      const anchor = preserveView && !latest ? pageRef.current?.turns.at(-1)?.id : null;
      const next = await fetchPage(null, anchor);
      if (next) {
        setPage(next);
        if (preserveView && selectedRecordRef.current && !next.records.some((record) => record.id === selectedRecordRef.current?.id)) {
          setSelectedRecord(null);
          setDetail(null);
        }
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [enabled, fetchPage, sessionId]);

  useEffect(() => {
    if (!enabled || !sessionId) {
      requestControllerRef.current?.abort();
      setPage(null);
      setError(null);
      setLoading(false);
      setSelectedRecord(null);
      setDetail(null);
      return;
    }
    void reload();
    return () => requestControllerRef.current?.abort();
  }, [activeLeafId, enabled, reload, sessionId]);

  const loadEarlier = useCallback(async () => {
    const current = pageRef.current;
    if (!enabled || !sessionId || !current?.hasEarlier || !current.nextCursor || loadingEarlierRef.current) return;
    loadingEarlierRef.current = true;
    setLoadingEarlier(true);
    try {
      const older = await fetchPage(current.nextCursor);
      if (!older) return;
      setPage((previous) => {
        if (!previous) return older;
        return {
          ...older,
          turns: [...older.turns, ...previous.turns],
          records: [...older.records, ...previous.records],
        };
      });
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      loadingEarlierRef.current = false;
      setLoadingEarlier(false);
    }
  }, [enabled, fetchPage, sessionId]);

  const ensureTurnLoaded = useCallback(async (turnId: string): Promise<boolean> => {
    if (!enabled || !sessionId) return false;
    if (pageRef.current?.turns.some((turn) => turn.id === turnId)) return true;
    try {
      // The anchored page replaces the window so a search hit far back needs
      // exactly one request; `hasLater` lets the pane offer "jump to latest".
      const next = await fetchPage(null, turnId);
      if (!next) return false;
      setPage(next);
      setSelectedRecord(null);
      setDetail(null);
      setDetailError(null);
      return next.turns.some((turn) => turn.id === turnId);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      return false;
    }
  }, [enabled, fetchPage, sessionId]);

  const selectRecord = useCallback(async (record: TrajectoryRecord | null) => {
    detailControllerRef.current?.abort();
    setSelectedRecord(record);
    setDetail(null);
    setDetailError(null);
    if (!record || !isInspectableTrajectoryRecord(record) || !enabled || !sessionId) return;

    const controller = new AbortController();
    detailControllerRef.current = controller;
    setDetailLoading(true);
    const params = new URLSearchParams();
    if (activeLeafId) params.set("leafId", activeLeafId);
    if (record.toolCallId) params.set("toolCallId", record.toolCallId);
    // Stable record ids keep thinking rows distinct from their assistant entry.
    params.set("recordId", record.id);
    const query = params.toString();
    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/trajectory/records/${encodeURIComponent(record.entryId)}${query ? `?${query}` : ""}`,
        { signal: controller.signal, cache: "no-store" },
      );
      const data = await response.json() as TrajectoryRecordDetail & TrajectoryResponseError;
      if (!response.ok) throw responseError(response, data);
      if (detailControllerRef.current === controller) setDetail(data);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setDetailError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (detailControllerRef.current === controller) setDetailLoading(false);
    }
  }, [activeLeafId, enabled, sessionId]);

  const busy = agentRunning || bashRunning || isCompacting || streamState.isStreaming;
  useEffect(() => {
    startsRef.current = { tools: new Map() };
  }, [activeLeafId, sessionId]);

  useEffect(() => {
    const starts = startsRef.current;
    const now = Date.now();
    if (streamState.isStreaming) starts.assistant ??= now;
    else delete starts.assistant;
    if (bashRunning) starts.bash ??= now;
    else delete starts.bash;
    if (agentPhase?.kind === "running_command") starts.command ??= now;
    else delete starts.command;
    if (isCompacting) starts.compaction ??= now;
    else delete starts.compaction;
    const activeToolIds = new Set(agentPhase?.kind === "running_tools" ? agentPhase.tools.map((tool) => tool.id) : []);
    for (const toolId of starts.tools.keys()) {
      if (!activeToolIds.has(toolId)) starts.tools.delete(toolId);
    }
    if (agentPhase?.kind === "running_tools") {
      for (const tool of agentPhase.tools) starts.tools.set(tool.id, starts.tools.get(tool.id) ?? now);
    }
  }, [agentPhase, bashRunning, isCompacting, streamState.isStreaming]);

  useEffect(() => {
    if (!busy) return;
    setLiveNow(Date.now());
    const timer = setInterval(() => setLiveNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (wasBusyRef.current && !busy && enabled && sessionId) void reload({ preserveView: true, latest: true });
    wasBusyRef.current = busy;
  }, [busy, enabled, reload, sessionId]);

  const liveRecords = useMemo(() => buildLiveTrajectoryRecords({
    now: liveNow,
    starts: startsRef.current,
    agentRunning,
    bashRunning,
    pendingBash,
    isCompacting,
    agentPhase: agentPhase as LiveTrajectoryPhase | null,
    streamState,
    activeToolResults,
    liveUserMessage,
    runError,
    loadingLabel: liveLoadingLabel,
  }), [activeToolResults, agentPhase, agentRunning, bashRunning, isCompacting, liveLoadingLabel, liveNow, liveUserMessage, pendingBash, runError, streamState]);

  useEffect(() => () => {
    requestControllerRef.current?.abort();
    detailControllerRef.current?.abort();
  }, []);

  return {
    page,
    loading,
    loadingEarlier,
    error,
    loadEarlier,
    reload,
    ensureTurnLoaded,
    liveRecords,
    selectedRecord,
    detail,
    detailLoading,
    detailError,
    selectRecord,
  };
}
