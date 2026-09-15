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
}

function truncate(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= MAX_LIVE_PREVIEW_LENGTH
    ? trimmed
    : `${trimmed.slice(0, MAX_LIVE_PREVIEW_LENGTH - 1)}…`;
}

function messagePreview(message: AssistantMessage): string | undefined {
  const text: string[] = [];
  const thinking: string[] = [];
  let hasImage = false;
  for (const block of message.content ?? []) {
    if (block.type === "text") text.push(block.text);
    else if (block.type === "thinking") thinking.push(block.thinking);
    else if (block.type === "image") hasImage = true;
  }
  const preview = text.join("\n") || thinking.join("\n") || (hasImage ? "[image]" : "");
  return truncate(preview) || undefined;
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
}: BuildLiveTrajectoryRecordsOptions): TrajectoryRecord[] {
  const records: TrajectoryRecord[] = [];
  if (streamState.isStreaming && streamState.streamingMessage) {
    const record = baseRecord("live:assistant", "assistant", "Assistant step", "live:assistant", now, starts.assistant);
    record.preview = messagePreview(streamState.streamingMessage);
    record.provider = streamState.streamingMessage.provider;
    record.modelId = streamState.streamingMessage.model;
    records.push(record);
  } else if (agentRunning && agentPhase?.kind === "waiting_model") {
    records.push(baseRecord("live:assistant", "assistant", "Waiting for model", "live:assistant", now, starts.assistant));
  } else if (agentRunning && agentPhase?.kind === "running_command") {
    records.push(baseRecord("live:command", "custom", "Running command", "live:command", now, starts.command));
  }

  if (agentPhase?.kind === "running_tools") {
    for (const tool of agentPhase.tools ?? []) {
      const record = baseRecord(`live:tool:${tool.id}`, "tool", tool.name, `live:tool:${tool.id}`, now, starts.tools.get(tool.id));
      record.parentId = "live:assistant";
      record.toolCallId = tool.id;
      record.toolName = tool.name;
      record.source.toolCallId = tool.id;
      record.preview = tool.progress;
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

  if (!agentRunning && !bashRunning && !isCompacting) return [];
  return records;
}
