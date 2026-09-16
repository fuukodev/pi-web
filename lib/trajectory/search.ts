import { sliceActiveBranch } from "../session-reader";
import type { SessionEntry } from "../types";
import { projectTrajectory } from "./project";
import {
  TRAJECTORY_SEARCH_QUERY_MAX,
  TRAJECTORY_SEARCH_TYPES,
  type TrajectorySearchField,
  type TrajectorySearchMatch,
  type TrajectorySearchResponse,
  type TrajectorySearchType,
} from "./search-query";
import type { TrajectoryRecord } from "./types";

export {
  TRAJECTORY_SEARCH_QUERY_MAX,
  TRAJECTORY_SEARCH_TYPES,
  parseTrajectorySearchQuery,
  withTrajectorySearchType,
} from "./search-query";
export type {
  ParsedTrajectorySearchQuery,
  TrajectorySearchField,
  TrajectorySearchMatch,
  TrajectorySearchResponse,
  TrajectorySearchType,
} from "./search-query";

export const TRAJECTORY_SEARCH_LIMIT_MAX = 100;
export const TRAJECTORY_SEARCH_RESULTS_DEFAULT = 50;

const MAX_MATCHES = 1000;
const TIME_BUDGET_MS = 3000;
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 80;
const ARG_MAX_DEPTH = 3;
const ARG_MAX_KEYS = 100;
const ARG_MAX_STRING = 2048;
const ARG_MAX_PART = 256;
const ARG_MAX_TOTAL = 16 * 1024;

export type TrajectorySearchErrorCode = "invalid_query";

export class TrajectorySearchError extends Error {
  readonly code: TrajectorySearchErrorCode;

  constructor(code: TrajectorySearchErrorCode, message: string) {
    super(message);
    this.name = "TrajectorySearchError";
    this.code = code;
  }
}

export interface BuildTrajectorySearchOptions {
  query: string;
  types?: readonly TrajectorySearchType[];
  limit?: number;
}

interface SearchCandidate {
  field: TrajectorySearchField;
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function invalid(message: string): TrajectorySearchError {
  return new TrajectorySearchError("invalid_query", message);
}

function normalizeTypes(types: readonly TrajectorySearchType[] | undefined): TrajectorySearchType[] {
  if (types === undefined) return [...TRAJECTORY_SEARCH_TYPES];
  if (!Array.isArray(types) || types.length === 0) throw invalid("types must not be empty");
  const requested = new Set<TrajectorySearchType>();
  for (const type of types) {
    if (!(TRAJECTORY_SEARCH_TYPES as readonly string[]).includes(type)) {
      throw invalid(`unknown search type: ${String(type)}`);
    }
    requested.add(type);
  }
  return TRAJECTORY_SEARCH_TYPES.filter((type) => requested.has(type));
}

function textFromBlocks(content: unknown, type: "text" | "thinking"): string {
  if (typeof content === "string") return type === "text" ? content : "";
  if (!Array.isArray(content)) return "";
  const values: string[] = [];
  for (const block of content) {
    if (!isRecord(block) || block.type !== type) continue;
    if (type === "text" && typeof block.text === "string") values.push(block.text);
    if (type === "thinking" && typeof block.thinking === "string") values.push(block.thinking);
  }
  return values.join("\n");
}

function findToolCall(content: unknown, toolCallId: string | undefined): Record<string, unknown> | null {
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (!isRecord(block) || block.type !== "toolCall") continue;
    const id = typeof block.toolCallId === "string" ? block.toolCallId : block.id;
    if (id === toolCallId) return block;
  }
  return null;
}

/**
 * Flattens tool arguments into bounded `key=value` text. Strings are capped so
 * a single large `write` payload cannot dominate a full-branch scan.
 */
function argumentText(input: unknown): string {
  if (input === undefined || input === null) return "";
  if (typeof input !== "object") return String(input);
  const parts: string[] = [];
  let total = 0;

  const put = (text: string) => {
    if (total >= ARG_MAX_TOTAL || !text) return;
    const clipped = text.length > ARG_MAX_PART ? text.slice(0, ARG_MAX_PART) : text;
    parts.push(clipped);
    total += clipped.length + 1;
  };

  const visit = (value: unknown, depth: number, key?: string): void => {
    if (total >= ARG_MAX_TOTAL) return;
    const prefix = key ? `${key}=` : "";
    if (typeof value === "string") {
      put(`${prefix}${value.slice(0, ARG_MAX_STRING)}`);
      return;
    }
    if (typeof value === "number" || typeof value === "boolean" || value === null) {
      put(`${prefix}${String(value)}`);
      return;
    }
    if (depth >= ARG_MAX_DEPTH) {
      put(`${prefix}{…}`);
      return;
    }
    if (Array.isArray(value)) {
      const items = value.slice(0, ARG_MAX_KEYS);
      for (const item of items) visit(item, depth + 1, key);
      if (value.length > items.length) put(`${key ?? ""}[${value.length - items.length} more]`);
      return;
    }
    if (typeof value === "object") {
      const objectEntries = Object.entries(value as Record<string, unknown>).slice(0, ARG_MAX_KEYS);
      for (const [childKey, childValue] of objectEntries) visit(childValue, depth + 1, childKey);
    }
  };

  visit(input, 0);
  return parts.join(" ");
}

function candidatesFor(record: TrajectoryRecord, entry: SessionEntry | undefined): SearchCandidate[] {
  if (!entry || entry.type !== "message") return [];
  const message = entry.message;
  if (record.kind === "user") {
    return message.role === "user" ? [{ field: "text", text: collapse(textFromBlocks(message.content, "text")) }] : [];
  }
  if (record.kind === "assistant") return [];
  if (record.kind === "text") {
    if (message.role !== "assistant") return [];
    const block = record.blockIndex !== undefined && Array.isArray(message.content)
      ? message.content[record.blockIndex]
      : undefined;
    return block?.type === "text" ? [{ field: "text", text: collapse(block.text) }] : [];
  }
  if (record.kind === "thinking") {
    if (message.role !== "assistant") return [];
    const block = record.blockIndex !== undefined && Array.isArray(message.content)
      ? message.content[record.blockIndex]
      : undefined;
    return block?.type === "thinking" ? [{ field: "thinking", text: collapse(block.thinking) }] : [];
  }
  if (record.kind === "tool") {
    if (message.role === "assistant") {
      const call = findToolCall(message.content, record.toolCallId);
      if (!call) return [];
      const name = typeof call.toolName === "string" ? call.toolName : typeof call.name === "string" ? call.name : "";
      return [
        { field: "toolName", text: collapse(name) },
        { field: "toolInput", text: collapse(argumentText(call.input ?? call.arguments)) },
      ];
    }
    if (message.role === "toolResult" && message.toolCallId === record.toolCallId) {
      return [{ field: "toolName", text: collapse(message.toolName ?? "") }];
    }
  }
  return [];
}

function windowSnippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - SNIPPET_BEFORE);
  const end = Math.min(text.length, index + length + SNIPPET_AFTER);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

/**
 * Searches user/assistant text, thinking, and tool call signatures on one
 * already-selected active branch. The scan is bounded by query length, result
 * limit, match cap, and a wall-clock budget so large sessions degrade into a
 * `truncated` response instead of blocking the route.
 */
export function buildTrajectorySearch(
  entries: readonly SessionEntry[],
  leafId: string | null | undefined,
  options: BuildTrajectorySearchOptions,
): TrajectorySearchResponse {
  const rawQuery = typeof options.query === "string" ? options.query : "";
  const term = collapse(rawQuery);
  if (!term) throw invalid("query is required");
  if (rawQuery.trim().length > TRAJECTORY_SEARCH_QUERY_MAX) {
    throw invalid(`query must be ${TRAJECTORY_SEARCH_QUERY_MAX} characters or fewer`);
  }
  const types = normalizeTypes(options.types);
  const limit = options.limit ?? TRAJECTORY_SEARCH_RESULTS_DEFAULT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > TRAJECTORY_SEARCH_LIMIT_MAX) {
    throw invalid(`limit must be an integer between 1 and ${TRAJECTORY_SEARCH_LIMIT_MAX}`);
  }

  const requestedLeafId = leafId ?? null;
  const branch = sliceActiveBranch([...entries], requestedLeafId, Math.max(entries.length, 1));
  if (requestedLeafId !== null && branch.at(-1)?.id !== requestedLeafId) {
    throw invalid("leafId is not part of this session");
  }
  const projection = projectTrajectory(branch);
  const entriesById = new Map(branch.map((entry) => [entry.id, entry]));
  const turnOrdinals = new Map(projection.turns.map((turn, index) => [turn.id, index + 1]));
  const allowed = new Set<string>(types);
  const needle = term.toLowerCase();
  const matches: TrajectorySearchMatch[] = [];
  const deadline = Date.now() + TIME_BUDGET_MS;
  let total = 0;
  let budgetExceeded = false;

  outer: for (let turnIndex = projection.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = projection.turns[turnIndex];
    for (let recordIndex = turn.records.length - 1; recordIndex >= 0; recordIndex -= 1) {
      // Enforce the wall-clock budget on every record: a query with no matches
      // would otherwise scan the whole branch unchecked.
      if (Date.now() > deadline) {
        budgetExceeded = true;
        break outer;
      }
      const record = turn.records[recordIndex];
      const searchType = record.kind === "text" ? "assistant" : record.kind;
      if (!allowed.has(searchType)) continue;

      let hit: { candidate: SearchCandidate; index: number } | null = null;
      for (const candidate of candidatesFor(record, entriesById.get(record.entryId))) {
        if (!candidate.text) continue;
        const index = candidate.text.toLowerCase().indexOf(needle);
        if (index >= 0) {
          hit = { candidate, index };
          break;
        }
      }
      if (!hit) continue;

      total += 1;
      if (matches.length < limit) {
        matches.push({
          record,
          turnOrdinal: turnOrdinals.get(turn.id) ?? 0,
          snippet: windowSnippet(hit.candidate.text, hit.index, needle.length),
          field: hit.candidate.field,
        });
      }
      if (total >= MAX_MATCHES) {
        budgetExceeded = true;
        break outer;
      }
    }
  }

  return {
    version: 1,
    query: term,
    types,
    matches,
    total,
    truncated: budgetExceeded || total > matches.length,
  };
}
