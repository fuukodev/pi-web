import type { AgentUsage } from "../types";

export type TrajectoryRecordKind =
  | "user"
  | "assistant"
  | "thinking"
  | "tool"
  | "bash"
  | "compaction"
  | "modelChange"
  | "thinkingChange"
  | "branchSummary"
  | "custom";

export type TrajectoryRecordStatus = "complete" | "running" | "error" | "unknown";
export type TrajectoryDurationSource = "estimated" | "live" | "unknown";

export interface TrajectoryRecordSource {
  entryId: string;
  resultEntryId?: string;
  toolCallId?: string;
}

export interface TrajectoryRecord {
  id: string;
  turnId: string;
  kind: TrajectoryRecordKind;
  status: TrajectoryRecordStatus;
  source: TrajectoryRecordSource;
  entryId: string;
  resultEntryId?: string;
  toolCallId?: string;
  toolName?: string;
  parentId?: string;
  summary: string;
  preview?: string;
  /** Tool result text, kept separate from the call signature in `preview`. */
  resultPreview?: string;
  error?: string;
  timestamp?: string;
  durationMs?: number;
  durationSource: TrajectoryDurationSource;
  usage?: AgentUsage;
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
}

export interface TrajectoryTurn {
  id: string;
  startEntryId: string;
  endEntryId: string;
  records: TrajectoryRecord[];
  timestamp?: string;
  endTimestamp?: string;
  durationMs?: number;
  durationSource: TrajectoryDurationSource;
}

export interface TrajectoryProjection {
  turns: TrajectoryTurn[];
  records: TrajectoryRecord[];
}

export interface TrajectoryBranchStats {
  turns: number;
  records: number;
  userMessages: number;
  assistantSteps: number;
  toolCalls: number;
  toolResults: number;
  errors: number;
  estimatedDurationMs: number;
}

export interface TrajectoryPage {
  version: 1;
  leafId: string | null;
  turns: TrajectoryTurn[];
  records: TrajectoryRecord[];
  nextCursor: string | null;
  hasEarlier: boolean;
  branchStats: TrajectoryBranchStats;
}
