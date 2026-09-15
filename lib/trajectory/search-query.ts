import type { TrajectoryRecord } from "./types";

export type TrajectorySearchType = "user" | "assistant" | "thinking" | "tool";
export type TrajectorySearchField = "text" | "thinking" | "toolName" | "toolInput";

export const TRAJECTORY_SEARCH_TYPES: readonly TrajectorySearchType[] = [
  "user",
  "assistant",
  "thinking",
  "tool",
];
export const TRAJECTORY_SEARCH_QUERY_MAX = 200;

const PREFIX_PATTERN = /^(user|assistant|thinking|think|th|tool|u|a|t)\s*:\s*/i;

export interface ParsedTrajectorySearchQuery {
  type: TrajectorySearchType | "all";
  term: string;
}

export interface TrajectorySearchMatch {
  record: TrajectoryRecord;
  turnOrdinal: number;
  snippet: string;
  field: TrajectorySearchField;
}

export interface TrajectorySearchResponse {
  version: 1;
  query: string;
  types: TrajectorySearchType[];
  matches: TrajectorySearchMatch[];
  total: number;
  truncated: boolean;
}

function normalizeType(token: string): TrajectorySearchType {
  switch (token.toLowerCase()) {
    case "u":
    case "user":
      return "user";
    case "a":
    case "assistant":
      return "assistant";
    case "th":
    case "think":
    case "thinking":
      return "thinking";
    default:
      return "tool";
  }
}

/**
 * Splits an optional leading type prefix (`user:`, `th:`, `tool:` …) from the
 * search term so the UI select and the typed text stay in agreement.
 *
 * This module must stay dependency-free: client components import it, while
 * `search.ts` adds the server-only branch scanner around it.
 */
export function parseTrajectorySearchQuery(raw: string): ParsedTrajectorySearchQuery {
  const trimmed = raw.trim();
  const match = PREFIX_PATTERN.exec(trimmed);
  if (!match) return { type: "all", term: trimmed };
  return { type: normalizeType(match[1]), term: trimmed.slice(match[0].length).trim() };
}

/** Rewrites the typed query so the select stays in sync with the text prefix. */
export function withTrajectorySearchType(raw: string, type: TrajectorySearchType | "all"): string {
  const { term } = parseTrajectorySearchQuery(raw);
  if (type === "all") return term;
  return `${type}: ${term}`.trim();
}
