import type {
  AssistantMessage,
  SessionEntry,
  ToolResultMessage,
} from "../types";
import { formatToolCallPreview } from "./tool-preview";
import { trajectoryTurnStatus } from "./runs";
import type {
  TrajectoryProjection,
  TrajectoryRecord,
  TrajectoryRecordKind,
  TrajectoryRecordStatus,
  TrajectoryTurn,
} from "./types";

const PRELUDE_TURN_ID = "turn:prelude";
const MAX_PREVIEW_LENGTH = 240;

type ToolCallData = {
  id: string;
  name: string;
  input?: unknown;
};

type ToolResultData = {
  entry: Extract<SessionEntry, { type: "message" }>;
  message: ToolResultMessage;
};

type MutableTurn = TrajectoryTurn & {
  firstTimestamp?: number;
  lastTimestamp?: number;
};

function isMessageEntry(entry: SessionEntry): entry is Extract<SessionEntry, { type: "message" }> {
  return entry.type === "message";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function truncate(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_PREVIEW_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_PREVIEW_LENGTH - 1)}…`;
}

function contentPreview(content: unknown): string | undefined {
  if (typeof content === "string") return truncate(content) || undefined;
  if (!Array.isArray(content)) return undefined;

  const text: string[] = [];
  const thinking: string[] = [];
  let hasImage = false;
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string") text.push(block.text);
    else if (block.type === "thinking" && typeof block.thinking === "string") thinking.push(block.thinking);
    else if (block.type === "image") hasImage = true;
  }
  const preview = text.join("\n") || thinking.join("\n") || (hasImage ? "[image]" : "");
  return truncate(preview) || undefined;
}

function blockPreview(block: unknown, type: "text" | "thinking"): string | undefined {
  if (!isRecord(block)) return undefined;
  const value = type === "text" ? block.text : block.thinking;
  return typeof value === "string" ? truncate(value) || undefined : undefined;
}

function readToolCall(block: unknown): ToolCallData | null {
  if (!isRecord(block) || block.type !== "toolCall") return null;
  const id = readString(block.toolCallId) ?? readString(block.id);
  const name = readString(block.toolName) ?? readString(block.name);
  if (!id || !name) return null;
  return { id, name, input: block.input ?? block.arguments };
}

function validTimestamp(value: unknown): { raw: string; ms: number } | undefined {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? { raw: value, ms } : undefined;
}

function durationBetween(start: unknown, end: unknown): number | undefined {
  const startTime = validTimestamp(start);
  const endTime = validTimestamp(end);
  if (!startTime || !endTime || endTime.ms < startTime.ms) return undefined;
  return endTime.ms - startTime.ms;
}

function statusForAssistant(message: AssistantMessage): {
  status: TrajectoryRecordStatus;
  error?: string;
} {
  if (message.stopReason === "error" || message.errorMessage) {
    return { status: "error", error: message.errorMessage?.trim() || "Unknown provider error" };
  }
  return { status: "complete" };
}

function pushRecord(turn: MutableTurn, record: TrajectoryRecord): void {
  turn.records.push(record);
}

function updateTurnBounds(turn: MutableTurn, entry: SessionEntry): void {
  turn.endEntryId = entry.id;
  const timestamp = validTimestamp(entry.timestamp);
  if (!timestamp) return;
  if (turn.firstTimestamp === undefined) {
    turn.firstTimestamp = timestamp.ms;
    turn.timestamp = timestamp.raw;
  }
  turn.lastTimestamp = timestamp.ms;
  turn.endTimestamp = timestamp.raw;
}

function finalizeTurn(turn: MutableTurn): TrajectoryTurn {
  const durationMs = turn.firstTimestamp !== undefined && turn.lastTimestamp !== undefined
    ? Math.max(0, turn.lastTimestamp - turn.firstTimestamp)
    : undefined;
  const result = { ...turn };
  delete result.firstTimestamp;
  delete result.lastTimestamp;
  const finalStatus = turn.records.length > 0 ? trajectoryTurnStatus(turn.records) : undefined;
  return {
    ...result,
    ...(finalStatus ? { finalStatus } : {}),
    ...(durationMs !== undefined ? { durationMs, durationSource: "estimated" as const } : { durationSource: "unknown" }),
  };
}

function startTurn(entry: SessionEntry, index: number): MutableTurn {
  const id = entry.type === "message" && entry.message.role === "user"
    ? `turn:${entry.id}`
    : PRELUDE_TURN_ID + (index > 0 ? `:${index}` : "");
  return {
    id,
    startEntryId: entry.id,
    endEntryId: entry.id,
    records: [],
    durationSource: "unknown",
  };
}

function createRecordBase(
  turn: MutableTurn,
  entry: SessionEntry,
  kind: TrajectoryRecordKind,
  id = `entry:${entry.id}`,
): TrajectoryRecord {
  const timestamp = validTimestamp(entry.timestamp);
  return {
    id,
    turnId: turn.id,
    kind,
    status: "complete",
    source: { entryId: entry.id },
    entryId: entry.id,
    summary: kind,
    durationSource: "unknown",
    ...(timestamp ? { timestamp: timestamp.raw } : {}),
  };
}

function projectUser(turn: MutableTurn, entry: Extract<SessionEntry, { type: "message" }>): void {
  const message = entry.message;
  if (message.role !== "user") return;
  const record = createRecordBase(turn, entry, "user");
  record.summary = "User message";
  record.preview = contentPreview(message.content);
  pushRecord(turn, record);
}

function projectAssistant(
  turn: MutableTurn,
  entry: Extract<SessionEntry, { type: "message" }>,
  resultsByToolCall: Map<string, ToolResultData[]>,
  consumedResultIds: Set<string>,
): void {
  const message = entry.message as AssistantMessage;
  const record = createRecordBase(turn, entry, "assistant");
  const assistantStatus = statusForAssistant(message);
  const blocks = Array.isArray(message.content) ? message.content : [];
  const toolCalls = blocks.map(readToolCall).filter((call): call is ToolCallData => call !== null);
  record.status = assistantStatus.status;
  record.error = assistantStatus.error;
  record.summary = "assistant";
  record.provider = message.provider;
  record.modelId = message.model;
  record.usage = message.usage;
  record.stopReason = message.stopReason;
  record.toolCallCount = toolCalls.length;
  record.agentRunId = record.id;
  pushRecord(turn, record);

  for (const [blockIndex, block] of blocks.entries()) {
    if (isRecord(block) && block.type === "thinking") {
      const thinkingRecord = createRecordBase(turn, entry, "thinking", `thinking:${entry.id}${blockIndex === 0 ? "" : `:${blockIndex}`}`);
      thinkingRecord.parentId = record.id;
      thinkingRecord.agentRunId = record.id;
      thinkingRecord.blockIndex = blockIndex;
      thinkingRecord.source.blockIndex = blockIndex;
      thinkingRecord.summary = "thinking";
      thinkingRecord.preview = blockPreview(block, "thinking");
      pushRecord(turn, thinkingRecord);
      continue;
    }

    if (isRecord(block) && block.type === "text") {
      const textRecord = createRecordBase(turn, entry, "text", `text:${entry.id}:${blockIndex}`);
      textRecord.parentId = record.id;
      textRecord.agentRunId = record.id;
      textRecord.blockIndex = blockIndex;
      textRecord.source.blockIndex = blockIndex;
      textRecord.summary = "text";
      textRecord.preview = blockPreview(block, "text");
      pushRecord(turn, textRecord);
      continue;
    }

    const toolCall = readToolCall(block);
    if (!toolCall) continue;

    const result = resultsByToolCall.get(toolCall.id)?.find((candidate) => !consumedResultIds.has(candidate.entry.id));
    const resultMessage = result?.message;
    const toolRecord = createRecordBase(turn, entry, "tool", `tool:${entry.id}:${toolCall.id}`);
    toolRecord.parentId = record.id;
    toolRecord.agentRunId = record.id;
    toolRecord.blockIndex = blockIndex;
    toolRecord.source.blockIndex = blockIndex;
    toolRecord.toolCallId = toolCall.id;
    toolRecord.toolName = toolCall.name;
    toolRecord.summary = toolCall.name;
    toolRecord.preview = formatToolCallPreview(toolCall.name, toolCall.input);
    toolRecord.source.toolCallId = toolCall.id;
    if (result) {
      consumedResultIds.add(result.entry.id);
      toolRecord.resultEntryId = result.entry.id;
      toolRecord.source.resultEntryId = result.entry.id;
      toolRecord.resultPreview = contentPreview(resultMessage?.content);
      toolRecord.status = resultMessage?.isError ? "error" : "complete";
      toolRecord.error = resultMessage?.isError ? toolRecord.resultPreview ?? "Tool execution failed" : undefined;
      toolRecord.usage = resultMessage?.usage;
      const durationMs = durationBetween(entry.timestamp, result.entry.timestamp);
      if (durationMs !== undefined) {
        toolRecord.durationMs = durationMs;
        toolRecord.durationSource = "estimated";
      }
    } else {
      toolRecord.status = "unknown";
    }
    pushRecord(turn, toolRecord);
  }
}

function projectToolResult(
  turn: MutableTurn,
  entry: Extract<SessionEntry, { type: "message" }>,
): void {
  const message = entry.message as ToolResultMessage;
  const record = createRecordBase(turn, entry, "tool", `tool-result:${entry.id}`);
  record.toolCallId = message.toolCallId;
  record.toolName = message.toolName;
  record.summary = message.toolName ?? "Orphaned tool result";
  record.preview = contentPreview(message.content);
  record.resultPreview = record.preview;
  record.status = message.isError ? "error" : "unknown";
  record.error = message.isError ? record.resultPreview ?? "Tool execution failed" : undefined;
  record.usage = message.usage;
  record.resultEntryId = entry.id;
  record.source.toolCallId = message.toolCallId;
  record.source.resultEntryId = entry.id;
  pushRecord(turn, record);
}

function projectNonMessage(turn: MutableTurn, entry: SessionEntry): void {
  let kind: TrajectoryRecordKind | null = null;
  const record = entry.type === "message" ? null : createRecordBase(turn, entry, "custom");
  if (!record) return;

  switch (entry.type) {
    case "compaction":
      kind = "compaction";
      record.summary = "Compaction";
      record.preview = truncate(entry.summary) || undefined;
      record.usage = entry.usage;
      break;
    case "branch_summary":
      kind = "branchSummary";
      record.summary = "Branch summary";
      record.preview = truncate(entry.summary) || undefined;
      record.usage = entry.usage;
      break;
    case "model_change":
      kind = "modelChange";
      record.summary = "Model changed";
      record.provider = entry.provider;
      record.modelId = entry.modelId;
      record.preview = `${entry.provider}/${entry.modelId}`;
      break;
    case "thinking_level_change":
      kind = "thinkingChange";
      record.summary = "Thinking level changed";
      record.thinkingLevel = entry.thinkingLevel;
      record.preview = entry.thinkingLevel;
      break;
    case "custom_message":
      kind = "custom";
      record.summary = entry.customType;
      record.preview = contentPreview(entry.content);
      break;
    case "custom":
      kind = "custom";
      record.summary = entry.customType;
      break;
    default:
      return;
  }

  record.kind = kind;
  pushRecord(turn, record);
}

function projectMessage(
  turn: MutableTurn,
  entry: Extract<SessionEntry, { type: "message" }>,
  resultsByToolCall: Map<string, ToolResultData[]>,
  consumedResultIds: Set<string>,
): void {
  switch (entry.message.role) {
    case "user":
      projectUser(turn, entry);
      break;
    case "assistant":
      projectAssistant(turn, entry, resultsByToolCall, consumedResultIds);
      break;
    case "toolResult":
      if (!consumedResultIds.has(entry.id)) projectToolResult(turn, entry);
      break;
    case "bashExecution": {
      const record = createRecordBase(turn, entry, "bash");
      record.summary = entry.message.command;
      record.preview = contentPreview(entry.message.output);
      record.status = entry.message.exitCode && entry.message.exitCode !== 0 ? "error" : "complete";
      record.error = record.status === "error" ? `Exit code ${entry.message.exitCode}` : undefined;
      pushRecord(turn, record);
      break;
    }
    case "custom": {
      const record = createRecordBase(turn, entry, "custom");
      record.summary = entry.message.customType;
      record.preview = contentPreview(entry.message.content);
      pushRecord(turn, record);
      break;
    }
  }
}

/**
 * Projects one already-sliced active branch into stable trajectory records.
 * Branch selection and pagination belong to the session query layer; keeping
 * this function branch-agnostic makes the projection cheap to test and reuse.
 */
export function projectTrajectory(entries: readonly SessionEntry[]): TrajectoryProjection {
  const resultsByToolCall = new Map<string, ToolResultData[]>();
  for (const entry of entries) {
    if (!isMessageEntry(entry) || entry.message.role !== "toolResult") continue;
    const result = { entry, message: entry.message as ToolResultMessage };
    const results = resultsByToolCall.get(result.message.toolCallId) ?? [];
    results.push(result);
    resultsByToolCall.set(result.message.toolCallId, results);
  }

  const consumedResultIds = new Set<string>();
  const turns: MutableTurn[] = [];
  let currentTurn: MutableTurn | null = null;

  for (const [index, entry] of entries.entries()) {
    const startsTurn = isMessageEntry(entry) && entry.message.role === "user";
    if (!currentTurn || startsTurn) {
      if (currentTurn?.records.length) turns.push(currentTurn);
      currentTurn = startTurn(entry, index);
    }

    updateTurnBounds(currentTurn, entry);
    if (isMessageEntry(entry)) {
      projectMessage(currentTurn, entry, resultsByToolCall, consumedResultIds);
    } else {
      projectNonMessage(currentTurn, entry);
    }
  }
  if (currentTurn?.records.length) turns.push(currentTurn);

  const finalizedTurns = turns.map(finalizeTurn);
  return {
    turns: finalizedTurns,
    records: finalizedTurns.flatMap((turn) => turn.records),
  };
}

export { MAX_PREVIEW_LENGTH };
