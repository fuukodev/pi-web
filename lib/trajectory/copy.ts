import type { TrajectoryRecordDetail } from "./detail";
import type { TrajectoryRecord } from "./types";

type CopyMode = "text" | "thinking";

type DataRecord = Record<string, unknown>;

function isRecord(value: unknown): value is DataRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unbounded(value: unknown): unknown {
  if (isRecord(value) && value.truncated === true && typeof value.value === "string") {
    return value.value;
  }
  if (Array.isArray(value)) return value.map(unbounded);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unbounded(item)]));
  }
  return value;
}

function jsonText(value: unknown, compact = false): string {
  const normalized = unbounded(value);
  if (typeof normalized === "string") return normalized;
  if (normalized === undefined) return "";
  try {
    return JSON.stringify(normalized, null, compact ? undefined : 2) ?? "";
  } catch {
    return "[unavailable]";
  }
}

function imageText(block: DataRecord): string {
  const mime = typeof block.mime === "string" ? block.mime : "unknown";
  const bytes = typeof block.bytes === "number" ? `, ${block.bytes} bytes` : "";
  return `[image: ${mime}${bytes}]`;
}

function contentText(content: unknown, mode: CopyMode): string {
  if (typeof content === "string") return content;
  if (isRecord(content) && content.truncated === true && typeof content.value === "string") {
    return content.value;
  }
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const item of content) {
    if (!isRecord(item)) continue;
    if (mode === "text" && item.type === "text") {
      const text = jsonText(item.text);
      if (text) parts.push(text);
    } else if (mode === "thinking" && item.type === "thinking") {
      const thinking = jsonText(item.thinking);
      if (thinking) parts.push(thinking);
    } else if (mode === "text" && item.type === "image") {
      parts.push(imageText(item));
    }
  }
  return parts.join("\n");
}

function messageOf(detail: TrajectoryEntryDetailLike | undefined): DataRecord | undefined {
  return isRecord(detail?.message) ? detail.message : undefined;
}

interface TrajectoryEntryDetailLike {
  message?: unknown;
}

function toolCallFrom(message: DataRecord | undefined, toolCallId?: string): DataRecord | undefined {
  if (!Array.isArray(message?.content)) return undefined;
  return message.content.find((item): item is DataRecord => {
    if (!isRecord(item) || item.type !== "toolCall") return false;
    const id = typeof item.id === "string" ? item.id : item.toolCallId;
    return typeof id === "string" && id === toolCallId;
  });
}

function toolCommand(record: TrajectoryRecord, entryMessage: DataRecord | undefined): string {
  const call = toolCallFrom(entryMessage, record.toolCallId);
  const name = typeof call?.name === "string"
    ? call.name
    : typeof call?.toolName === "string" ? call.toolName : record.toolName ?? "tool";
  const input = call?.input ?? call?.arguments;
  const argumentsText = input === undefined ? "" : jsonText(input, true);
  return `${name}(${argumentsText})`;
}

function toolOutput(record: TrajectoryRecord, resultMessage: DataRecord | undefined): string {
  const content = contentText(resultMessage?.content, "text");
  if (content) return content;
  if (resultMessage?.details !== undefined) {
    const details = jsonText(resultMessage.details);
    if (details) return details;
  }
  return record.error ?? record.resultPreview ?? "(no output)";
}

function copyDirectRecord(record: TrajectoryRecord, entryMessage: DataRecord | undefined): string | null {
  const mode: CopyMode = record.kind === "thinking" ? "thinking" : "text";
  const content = contentText(entryMessage?.content, mode);
  if (content) return content;

  const errorMessage = typeof entryMessage?.errorMessage === "string" ? entryMessage.errorMessage : "";
  return errorMessage || null;
}

/**
 * Formats the bounded inspector DTO into clipboard-safe, human-readable text.
 * This intentionally copies only the selected record's semantic content rather
 * than the full JSON detail payload.
 */
export function buildTrajectoryCopyText(
  record: TrajectoryRecord,
  detail: TrajectoryRecordDetail,
): string | null {
  const entryMessage = messageOf(detail.entry);
  if (record.kind === "tool") {
    const command = toolCommand(record, entryMessage);
    const resultMessage = messageOf(detail.result);
    const label = record.status === "error" || resultMessage?.isError === true ? "error" : "output";
    return `${command}\n--- ${label} ---\n${toolOutput(record, resultMessage)}`;
  }

  if (record.kind === "user" || record.kind === "assistant" || record.kind === "thinking") {
    return copyDirectRecord(record, entryMessage);
  }

  return null;
}
