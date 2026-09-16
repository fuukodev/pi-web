import type { AssistantMessage } from "../types";
import type { TrajectoryRecord } from "./types";

const MAX_LIVE_PREVIEW_LENGTH = 240;

export interface LiveTrajectoryStarts {
  assistant?: number;
  bash?: number;
  command?: number;
  compaction?: number;
  tools: Map<string, number>;
}

export interface LiveTrajectoryStreamState {
  isStreaming: boolean;
  streamingMessage: AssistantMessage | null;
}

export interface LiveTrajectoryPhase {
  kind: "waiting_model" | "running_command" | "running_tools";
  tools?: { id: string; name: string; progress?: string }[];
}

export interface BuildLiveTrajectoryRecordsOptions {
  now: number;
  starts: LiveTrajectoryStarts;
  agentRunning: boolean;
  bashRunning: boolean;
  isCompacting: boolean;
  pendingBash: { command: string; excludeFromContext: boolean } | null;
  agentPhase: LiveTrajectoryPhase | null;
  streamState: LiveTrajectoryStreamState;
  activeToolResults?: ReadonlyMap<string, { isError?: boolean; content?: unknown }>;
  liveUserMessage?: string | null;
  runError?: string | null;
  loadingLabel?: string;
}

function truncate(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= MAX_LIVE_PREVIEW_LENGTH
    ? trimmed
    : `${trimmed.slice(0, MAX_LIVE_PREVIEW_LENGTH - 1)}…`;
}

function duration(now: number, startedAt: number | undefined): Pick<TrajectoryRecord, "durationMs" | "durationSource"> {
  return startedAt !== undefined && now >= startedAt
    ? { durationMs: now - startedAt, durationSource: "live" }
    : { durationSource: "live" };
}

function baseRecord(
  id: string,
  kind: TrajectoryRecord["kind"],
  summary: string,
  sourceEntryId: string,
  now: number,
  startedAt: number | undefined,
): TrajectoryRecord {
  return {
    id,
    turnId: "turn:live",
    kind,
    status: "running",
    source: { entryId: sourceEntryId },
    entryId: sourceEntryId,
    summary,
    ...duration(now, startedAt),
  };
}

export function buildLiveTrajectoryRecords({
  now,
  starts,
  agentRunning,
  bashRunning,
  isCompacting,
  pendingBash,
  agentPhase,
  streamState,
  activeToolResults,
  liveUserMessage,
  runError,
  loadingLabel = "Loading…",
}: BuildLiveTrajectoryRecordsOptions): TrajectoryRecord[] {
  const records: TrajectoryRecord[] = [];
  const active = agentRunning || bashRunning || isCompacting || streamState.isStreaming;
  if (!active) return [];

  if (liveUserMessage) {
    const userRecord = baseRecord("live:user", "user", "user", "live:user", now, undefined);
    userRecord.status = "complete";
    userRecord.preview = truncate(liveUserMessage) || undefined;
    records.push(userRecord);
  }

  if (agentRunning || streamState.isStreaming || runError) {
    const streamError = streamState.streamingMessage?.errorMessage;
    const record = baseRecord("live:assistant", "assistant", "assistant", "live:assistant", now, starts.assistant);
    record.agentRunId = record.id;
    record.preview = loadingLabel;
    record.provider = streamState.streamingMessage?.provider;
    record.modelId = streamState.streamingMessage?.model;
    const error = runError?.trim() || streamError?.trim();
    if (error || streamState.streamingMessage?.stopReason === "error") {
      record.status = "error";
      record.error = error || "Unknown provider error";
      record.preview = record.error;
    }
    records.push(record);
  }

  if (agentRunning && agentPhase?.kind === "running_command") {
    const record = baseRecord("live:command", "custom", "Running command", "live:command", now, starts.command);
    records.push(record);
  }

  if (agentPhase?.kind === "running_tools") {
    for (const tool of agentPhase.tools ?? []) {
      const record = baseRecord(`live:tool:${tool.id}`, "tool", tool.name, `live:tool:${tool.id}`, now, starts.tools.get(tool.id));
      record.parentId = "live:assistant";
      record.agentRunId = "live:assistant";
      record.toolCallId = tool.id;
      record.toolName = tool.name;
      record.source.toolCallId = tool.id;
      record.preview = tool.progress;
      const activeResult = activeToolResults?.get(tool.id);
      if (activeResult?.isError) {
        record.status = "error";
        const errorText = Array.isArray(activeResult.content)
          ? activeResult.content.filter((part): part is { type: "text"; text: string } => Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string")).map((part) => part.text).join(" ").trim()
          : "";
        record.error = errorText || "Tool execution failed";
      }
      records.push(record);
    }
  }

  if (bashRunning) {
    const record = baseRecord("live:bash", "bash", pendingBash?.command ?? "Running command", "live:bash", now, starts.bash);
    record.preview = pendingBash?.command;
    records.push(record);
  }

  if (isCompacting) {
    records.push(baseRecord("live:compaction", "compaction", "Compaction", "live:compaction", now, starts.compaction));
  }

  return records;
}
