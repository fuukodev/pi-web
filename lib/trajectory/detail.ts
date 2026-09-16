import type {
  AgentMessage,
  AssistantContentBlock,
  SessionEntry,
  ToolResultMessage,
} from "../types";
import { projectTrajectory } from "./project";
import type { TrajectoryRecord } from "./types";

export const MAX_TRAJECTORY_DETAIL_TEXT = 32 * 1024;
const MAX_TRAJECTORY_DETAIL_DEPTH = 4;
const MAX_TRAJECTORY_DETAIL_ITEMS = 100;

export type TrajectoryDetailErrorCode = "not_found" | "invalid_query";

export class TrajectoryDetailError extends Error {
  readonly code: TrajectoryDetailErrorCode;

  constructor(code: TrajectoryDetailErrorCode, message: string) {
    super(message);
    this.name = "TrajectoryDetailError";
    this.code = code;
  }
}

interface TruncatedText {
  value: string;
  truncated: true;
}

export interface TrajectoryEntryDetail {
  id: string;
  type: string;
  parentId: string | null;
  timestamp: string;
  message?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TrajectoryRecordDetail {
  version: 1;
  record: TrajectoryRecord;
  entry: TrajectoryEntryDetail;
  /** Payload belonging to the selected record, not the whole source entry. */
  payload: unknown;
  result?: TrajectoryEntryDetail;
  schema?: unknown;
  timing?: { durationMs?: number; durationSource: TrajectoryRecord["durationSource"] };
}

function boundedString(value: string): string | TruncatedText {
  if (value.length <= MAX_TRAJECTORY_DETAIL_TEXT) return value;
  return {
    value: `${value.slice(0, MAX_TRAJECTORY_DETAIL_TEXT - 1)}…`,
    truncated: true,
  };
}

function looksLikeBinary(value: string): boolean {
  return value.length > 256 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+=*$/.test(value);
}

function boundedValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return looksLikeBinary(value) ? "[binary data omitted]" : boundedString(value);
  if (depth >= MAX_TRAJECTORY_DETAIL_DEPTH) return "[nested value omitted]";
  if (Array.isArray(value)) {
    return value.slice(0, MAX_TRAJECTORY_DETAIL_ITEMS).map((item) => boundedValue(item, depth + 1));
  }
  if (typeof value !== "object") return String(value);

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_TRAJECTORY_DETAIL_ITEMS)) {
    if (key === "data" && typeof item === "string" && looksLikeBinary(item)) {
      result[key] = "[binary data omitted]";
    } else {
      result[key] = boundedValue(item, depth + 1);
    }
  }
  return result;
}

function imageDetail(block: Record<string, unknown>): Record<string, unknown> {
  const source = block.source;
  const sourceRecord = typeof source === "object" && source !== null && !Array.isArray(source)
    ? source as Record<string, unknown>
    : undefined;
  const data = typeof block.data === "string"
    ? block.data
    : typeof sourceRecord?.data === "string" ? sourceRecord.data : undefined;
  const mime = typeof block.mimeType === "string"
    ? block.mimeType
    : typeof sourceRecord?.media_type === "string" ? sourceRecord.media_type : undefined;
  return {
    type: "image",
    ...(mime ? { mime } : {}),
    ...(data ? { bytes: Math.max(0, Math.floor(data.length * 3 / 4)) } : {}),
    sourceType: sourceRecord?.type ?? (data ? "base64" : "unknown"),
  };
}

function contentDetail(content: unknown): unknown {
  if (typeof content === "string") return boundedString(content);
  if (!Array.isArray(content)) return boundedValue(content);

  return content.slice(0, MAX_TRAJECTORY_DETAIL_ITEMS).map((block): unknown => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return boundedValue(block);
    const record = block as Record<string, unknown>;
    switch (record.type) {
      case "text":
        return { type: "text", text: typeof record.text === "string" ? boundedString(record.text) : "" };
      case "thinking":
        return { type: "thinking", thinking: typeof record.thinking === "string" ? boundedString(record.thinking) : "" };
      case "image":
        return imageDetail(record);
      case "toolCall":
        return {
          type: "toolCall",
          ...(typeof record.toolCallId === "string" ? { id: record.toolCallId } : typeof record.id === "string" ? { id: record.id } : {}),
          ...(typeof record.toolName === "string" ? { name: record.toolName } : typeof record.name === "string" ? { name: record.name } : {}),
          input: boundedValue(record.input ?? record.arguments),
        };
      default:
        return boundedValue(record);
    }
  });
}

function messageDetail(message: AgentMessage): Record<string, unknown> {
  switch (message.role) {
    case "user":
      return { role: message.role, content: contentDetail(message.content) };
    case "assistant":
      return {
        role: message.role,
        provider: message.provider,
        model: message.model,
        stopReason: message.stopReason,
        errorMessage: message.errorMessage ? boundedString(message.errorMessage) : undefined,
        usage: boundedValue(message.usage),
        content: contentDetail(message.content),
      };
    case "toolResult": {
      const tool = message as ToolResultMessage;
      return {
        role: tool.role,
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        isError: tool.isError,
        usage: boundedValue(tool.usage),
        details: boundedValue(tool.details),
        content: contentDetail(tool.content),
      };
    }
    case "bashExecution":
      return {
        role: message.role,
        command: boundedString(message.command),
        output: boundedString(message.output),
        exitCode: message.exitCode,
        cancelled: message.cancelled,
        truncated: message.truncated,
      };
    case "custom":
      return {
        role: message.role,
        customType: message.customType,
        content: contentDetail(message.content),
        details: boundedValue(message.details),
      };
  }
}

function selectedPayload(record: TrajectoryRecord, entry: SessionEntry, resultEntry: SessionEntry | undefined): unknown {
  if (entry.type !== "message") return entryDetail(entry);
  const message = entry.message;
  if (record.kind === "tool" && message.role === "toolResult") return messageDetail(message);
  if (message.role !== "assistant") return messageDetail(message);
  if (record.kind === "assistant") return messageDetail(message);
  const block = Array.isArray(message.content) && record.blockIndex !== undefined
    ? message.content[record.blockIndex]
    : undefined;
  if (record.kind === "text" && block?.type === "text") return { type: "text", text: boundedString(block.text) };
  if (record.kind === "thinking" && block?.type === "thinking") return { type: "thinking", thinking: boundedString(block.thinking) };
  if (record.kind === "tool") {
    const toolBlock = block?.type === "toolCall"
      ? block
      : message.content.find((candidate) => candidate.type === "toolCall" && (candidate.toolCallId === record.toolCallId || (candidate as unknown as { id?: string }).id === record.toolCallId));
    if (toolBlock?.type === "toolCall") {
      const rawToolBlock = toolBlock as unknown as Record<string, unknown>;
      return {
        type: "toolCall",
        id: rawToolBlock.toolCallId ?? rawToolBlock.id,
        name: rawToolBlock.toolName ?? rawToolBlock.name,
        input: boundedValue(rawToolBlock.input ?? rawToolBlock.arguments),
      };
    }
  }
  return resultEntry ? entryDetail(resultEntry) : messageDetail(message);
}

function entryDetail(entry: SessionEntry): TrajectoryEntryDetail {
  const base = {
    id: entry.id,
    type: entry.type,
    parentId: entry.parentId,
    timestamp: entry.timestamp,
  };
  switch (entry.type) {
    case "message":
      return { ...base, message: messageDetail(entry.message) };
    case "compaction":
      return { ...base, summary: boundedString(entry.summary), firstKeptEntryId: entry.firstKeptEntryId, tokensBefore: entry.tokensBefore, usage: boundedValue(entry.usage), details: boundedValue(entry.details) };
    case "branch_summary":
      return { ...base, fromId: entry.fromId, summary: boundedString(entry.summary), usage: boundedValue(entry.usage), details: boundedValue(entry.details) };
    case "model_change":
      return { ...base, provider: entry.provider, modelId: entry.modelId };
    case "thinking_level_change":
      return { ...base, thinkingLevel: entry.thinkingLevel };
    case "custom_message":
      return { ...base, customType: entry.customType, display: entry.display, content: contentDetail(entry.content), details: boundedValue(entry.details) };
    case "custom":
      return { ...base, customType: entry.customType, data: boundedValue(entry.data) };
    case "label":
      return { ...base, label: entry.label };
    case "session_info":
      return { ...base, name: entry.name };
  }
}

/**
 * Creates bounded inspector data for an entry on an already-selected branch.
 * Raw session payloads are never returned directly, and base64 image bytes are
 * represented by metadata so the existing image endpoint remains the loader.
 */
export function buildTrajectoryRecordDetail(
  entries: readonly SessionEntry[],
  entryId: string,
  toolCallId?: string | null,
  recordId?: string | null,
  toolSchema?: unknown,
): TrajectoryRecordDetail {
  const projection = projectTrajectory(entries);
  const record = projection.records.find((candidate) => (
    (recordId
      ? candidate.id === recordId
      : candidate.entryId === entryId || candidate.resultEntryId === entryId)
      && (!toolCallId || candidate.toolCallId === toolCallId)
  ));
  if (!record) throw new TrajectoryDetailError("not_found", "Trajectory record not found");

  const entry = entries.find((candidate) => candidate.id === entryId);
  if (!entry) throw new TrajectoryDetailError("not_found", "Trajectory entry not found");
  const resultEntry = record.resultEntryId
    ? entries.find((candidate) => candidate.id === record.resultEntryId)
    : undefined;

  return {
    version: 1,
    record,
    entry: entryDetail(entry),
    payload: selectedPayload(record, entry, resultEntry),
    ...(resultEntry ? { result: entryDetail(resultEntry) } : {}),
    ...(record.kind === "tool" && toolSchema !== undefined ? { schema: boundedValue(toolSchema) } : {}),
    ...(record.kind === "tool" ? { timing: { durationMs: record.durationMs, durationSource: record.durationSource } } : {}),
  };
}
