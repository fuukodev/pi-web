import type { TrajectoryRecord } from "./types";

const INSPECTABLE_KINDS = new Set<TrajectoryRecord["kind"]>(["user", "assistant", "tool"]);

export function isInspectableTrajectoryRecord(record: TrajectoryRecord | null): boolean {
  return Boolean(record && !record.id.startsWith("live:") && INSPECTABLE_KINDS.has(record.kind));
}
