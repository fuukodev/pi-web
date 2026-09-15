import { sliceActiveBranch } from "../session-reader";
import type { SessionEntry } from "../types";
import { projectTrajectory } from "./project";
import type {
  TrajectoryBranchStats,
  TrajectoryPage,
  TrajectoryRecord,
  TrajectoryTurn,
} from "./types";

export const TRAJECTORY_PAGE_LIMIT_MIN = 1;
export const TRAJECTORY_PAGE_LIMIT_MAX = 50;

export type TrajectoryQueryErrorCode = "invalid_leaf" | "invalid_cursor" | "invalid_anchor" | "invalid_limit";

export class TrajectoryQueryError extends Error {
  readonly code: TrajectoryQueryErrorCode;

  constructor(code: TrajectoryQueryErrorCode, message: string) {
    super(message);
    this.name = "TrajectoryQueryError";
    this.code = code;
  }
}

export interface BuildTrajectoryPageOptions {
  limit: number;
  cursor?: string | null;
  /** Turn start entry id to include as the newest turn of the page. */
  anchorTurnId?: string | null;
}

function branchStats(turns: readonly TrajectoryTurn[], records: readonly TrajectoryRecord[]): TrajectoryBranchStats {
  let userMessages = 0;
  let assistantSteps = 0;
  let toolCalls = 0;
  let toolResults = 0;
  let errors = 0;
  let estimatedDurationMs = 0;

  for (const record of records) {
    if (record.kind === "user") userMessages += 1;
    if (record.kind === "assistant") assistantSteps += 1;
    if (record.kind === "tool") {
      toolCalls += 1;
      if (record.resultEntryId) toolResults += 1;
    }
    if (record.status === "error") errors += 1;
  }
  for (const turn of turns) {
    if (turn.durationSource === "estimated" && turn.durationMs !== undefined) {
      estimatedDurationMs += turn.durationMs;
    }
  }

  return {
    turns: turns.length,
    records: records.length,
    userMessages,
    assistantSteps,
    toolCalls,
    toolResults,
    errors,
    estimatedDurationMs,
  };
}

function validateLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < TRAJECTORY_PAGE_LIMIT_MIN || limit > TRAJECTORY_PAGE_LIMIT_MAX) {
    throw new TrajectoryQueryError(
      "invalid_limit",
      `limit must be an integer between ${TRAJECTORY_PAGE_LIMIT_MIN} and ${TRAJECTORY_PAGE_LIMIT_MAX}`,
    );
  }
}

/**
 * Builds a page from a full session entry list while transferring only complete
 * logical turns. The session reader owns active-branch traversal; this helper
 * deliberately receives the raw list so callers cannot accidentally project a
 * sibling branch by filtering after projection.
 */
export function buildTrajectoryPage(
  entries: readonly SessionEntry[],
  leafId: string | null | undefined,
  options: BuildTrajectoryPageOptions,
): TrajectoryPage {
  validateLimit(options.limit);
  const requestedLeafId = leafId ?? null;
  const branch = sliceActiveBranch(
    [...entries],
    requestedLeafId,
    Math.max(entries.length, 1),
  );
  const resolvedLeafId = branch.at(-1)?.id ?? null;
  if (requestedLeafId !== null && resolvedLeafId !== requestedLeafId) {
    throw new TrajectoryQueryError("invalid_leaf", "leafId is not part of this session");
  }

  const projection = projectTrajectory(branch);
  const allTurns = projection.turns;
  const allRecords = projection.records;
  const cursor = options.cursor ?? null;
  const anchorTurnId = options.anchorTurnId ?? null;
  if (cursor !== null && anchorTurnId !== null) {
    throw new TrajectoryQueryError("invalid_anchor", "cursor and anchor cannot be combined");
  }
  let endExclusive = allTurns.length;
  if (cursor !== null) {
    const cursorIndex = allTurns.findIndex((turn) => turn.startEntryId === cursor);
    if (cursorIndex < 0) {
      throw new TrajectoryQueryError("invalid_cursor", "cursor is not a turn boundary on this branch");
    }
    endExclusive = cursorIndex;
  } else if (anchorTurnId !== null) {
    const anchorIndex = allTurns.findIndex((turn) => turn.startEntryId === anchorTurnId);
    if (anchorIndex < 0) {
      throw new TrajectoryQueryError("invalid_anchor", "anchor is not a turn boundary on this branch");
    }
    endExclusive = anchorIndex + 1;
  }

  const start = Math.max(0, endExclusive - options.limit);
  const turns = allTurns.slice(start, endExclusive);
  const records = turns.flatMap((turn) => turn.records);
  const hasEarlier = start > 0;
  const nextCursor = hasEarlier ? turns[0]?.startEntryId ?? null : null;

  return {
    version: 1,
    leafId: resolvedLeafId,
    turns,
    records,
    nextCursor,
    hasEarlier,
    hasLater: endExclusive < allTurns.length,
    branchStats: branchStats(allTurns, allRecords),
  };
}
