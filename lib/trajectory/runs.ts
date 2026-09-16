import type { TrajectoryRecord, TrajectoryRecordStatus } from "./types";

export interface TrajectoryRecordGroup {
  type: "record";
  record: TrajectoryRecord;
}

export interface TrajectoryAgentRunGroup {
  type: "run";
  id: string;
  records: TrajectoryRecord[];
  status: TrajectoryRecordStatus;
}

export type TrajectoryRunGroup = TrajectoryRecordGroup | TrajectoryAgentRunGroup;

function runStatus(records: readonly TrajectoryRecord[]): TrajectoryRecordStatus {
  const terminal = records.filter((record) => (
    record.kind === "assistant" || record.kind === "tool" || record.kind === "bash"
  ));
  const candidate = terminal.at(-1) ?? records.at(-1);
  return candidate?.status ?? "unknown";
}

/** Groups each assistant root with its ordered child records. */
export function groupTrajectoryRuns(records: readonly TrajectoryRecord[]): TrajectoryRunGroup[] {
  const groups: TrajectoryRunGroup[] = [];
  let active: TrajectoryAgentRunGroup | null = null;

  const flush = () => {
    if (!active) return;
    active.status = runStatus(active.records);
    groups.push(active);
    active = null;
  };

  for (const record of records) {
    if (record.agentRunId) {
      if (!active || active.id !== record.agentRunId) {
        flush();
        active = { type: "run", id: record.agentRunId, records: [], status: "unknown" };
      }
      active.records.push(record);
      continue;
    }
    flush();
    groups.push({ type: "record", record });
  }
  flush();
  return groups;
}

/** Returns the final status of the last agent run in a turn. */
export function trajectoryTurnStatus(records: readonly TrajectoryRecord[]): TrajectoryRecordStatus {
  const groups = groupTrajectoryRuns(records);
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group.type === "run") return group.status;
  }
  return records.at(-1)?.status ?? "unknown";
}
