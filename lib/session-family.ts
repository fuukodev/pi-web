import type { SessionInfo } from "./types";

export interface SessionFamily {
  root: SessionInfo;
  /** All nested descendants, kept for generic child-session navigation. */
  children: SessionInfo[];
  subagents: SessionInfo[];
  consultations: SessionInfo[];
  latestModified: string;
}

function isNestedSession(session: SessionInfo): boolean {
  return session.relation?.kind === "subagent" || session.relation?.kind === "consultation";
}

function resolveFamilyRoots(sessions: readonly SessionInfo[]): Map<string, string | null> {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const roots = new Map<string, string | null>();

  for (const session of sessions) {
    if (roots.has(session.id)) continue;

    const path: string[] = [];
    const visited = new Set<string>();
    let currentId = session.id;
    let rootId: string | null = null;

    while (true) {
      if (roots.has(currentId)) {
        rootId = roots.get(currentId) ?? null;
        break;
      }
      if (visited.has(currentId)) break;

      visited.add(currentId);
      path.push(currentId);
      const current = byId.get(currentId);
      if (!current) break;
      const relation = current.relation;
      if (!relation || (relation.kind !== "subagent" && relation.kind !== "consultation")) {
        rootId = current.id;
        break;
      }
      currentId = relation.parentSessionId;
    }

    for (const id of path) roots.set(id, rootId);
  }

  return roots;
}

/** Groups visible main/fork sessions with every persisted nested child descendant. */
export function listSessionFamilies(sessions: readonly SessionInfo[]): SessionFamily[] {
  const rootsBySessionId = resolveFamilyRoots(sessions);
  const families = new Map<string, SessionFamily>();

  for (const session of sessions) {
    if (isNestedSession(session)) continue;
    families.set(session.id, {
      root: session,
      children: [],
      subagents: [],
      consultations: [],
      latestModified: session.modified,
    });
  }

  for (const session of sessions) {
    if (!isNestedSession(session)) continue;
    const rootId = rootsBySessionId.get(session.id);
    const family = rootId ? families.get(rootId) : undefined;
    if (!family) continue;
    family.children.push(session);
    if (session.relation?.kind === "subagent") family.subagents.push(session);
    if (session.relation?.kind === "consultation") family.consultations.push(session);
    if (session.modified > family.latestModified) family.latestModified = session.modified;
  }

  return [...families.values()].sort((a, b) => b.latestModified.localeCompare(a.latestModified));
}

export function getSessionFamily(
  sessions: readonly SessionInfo[],
  sessionId: string | null | undefined,
): SessionFamily | null {
  if (!sessionId) return null;
  return listSessionFamilies(sessions).find((family) => (
    family.root.id === sessionId
    || family.children.some((session) => session.id === sessionId)
  )) ?? null;
}
