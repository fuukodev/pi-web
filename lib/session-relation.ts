import type { ConsultationMetadata } from "./session-consultation";
import type { SubagentRunInfo } from "./subagents";
import type { SessionInfo, SubagentSessionStatus } from "./types";

export type SessionRelation = NonNullable<SessionInfo["relation"]>;

export interface BuildSessionRelationOptions {
  consultation?: ConsultationMetadata | null;
  subagent?: SubagentRunInfo | null;
  subagentStatus?: SubagentSessionStatus;
  parentSessionPath?: string;
  originSessionId?: string;
}

/** Classifies persisted/runtime parent metadata in one deterministic order. */
export function buildSessionRelation({
  consultation,
  subagent,
  subagentStatus,
  parentSessionPath,
  originSessionId,
}: BuildSessionRelationOptions): SessionRelation | undefined {
  if (consultation) {
    return {
      kind: "consultation",
      parentSessionId: consultation.parentSessionId,
      contextMode: consultation.contextMode,
      source: consultation.source,
      promptVersion: consultation.promptVersion,
    };
  }
  if (subagent) {
    return {
      kind: "subagent",
      parentSessionId: subagent.parentSessionId,
      profile: subagent.profile,
      description: subagent.description,
      status: subagentStatus ?? subagent.status,
    };
  }
  if (parentSessionPath) {
    return {
      kind: "fork",
      ...(originSessionId ? { originSessionId } : {}),
    };
  }
  return undefined;
}
