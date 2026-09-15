import type { TrajectoryRecord } from "./types";

/** Shared i18n keys for record kinds, used by the ledger, search, and inspector. */
export const TRAJECTORY_KIND_LABEL_KEYS: Record<TrajectoryRecord["kind"], string> = {
  user: "trajectory.user",
  assistant: "trajectory.assistant",
  thinking: "trajectory.thinking",
  tool: "trajectory.tool",
  bash: "trajectory.bash",
  compaction: "trajectory.compaction",
  modelChange: "trajectory.modelChange",
  thinkingChange: "trajectory.thinkingChange",
  branchSummary: "trajectory.branchSummary",
  custom: "trajectory.custom",
};
