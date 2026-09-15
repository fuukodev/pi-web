import type { AgentUsage } from "../types";

export type TrajectoryRecordKind =
  | "user"
  | "assistant"
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
