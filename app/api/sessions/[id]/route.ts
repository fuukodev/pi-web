import { NextResponse } from "next/server";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  attachSessionProjectInfo,
  resolveSessionPath,
  resolveSessionIdByPath,
  invalidateSessionPathCache,
  invalidateSessionListCache,
  buildSessionContext,
  readSessionHeader,
} from "@/lib/session-reader";
import { sessionPathKey } from "@/lib/session-path";
import { getRpcSession } from "@/lib/rpc-manager";
import { projectTreeForResponse } from "@/lib/project-tree";
import { computeSessionTotalActiveMs } from "@/lib/session-timing";
import { computeSessionStats } from "@/lib/session-stats";
import type { SessionEntry } from "@/lib/types";
import { readSubagentRun, readSubagentSessionResources, SUBAGENT_META_TYPE } from "@/lib/subagents";
import { readConsultationMetadata } from "@/lib/session-consultation";
import { buildSessionRelation } from "@/lib/session-relation";
import { readSessionToolSelection } from "@/lib/session-tool-selection";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const resolvedPath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !resolvedPath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sm = liveRpc?.inner.sessionManager ?? SessionManager.open(resolvedPath!);
    const filePath = liveRpc?.sessionFile || sm.getSessionFile() || resolvedPath || "";
    const entries = sm.getEntries();
    const leafId = sm.getLeafId();
    const tree = projectTreeForResponse(sm.getTree());
    const searchParams = new URL(req.url).searchParams;
    const deferThinking = searchParams.has("deferThinking");
    const deferToolResultImages = searchParams.has("deferMedia");
    const rawTail = Number(searchParams.get("tail"));
    const tail = Number.isFinite(rawTail) && rawTail > 0 ? Math.min(rawTail, 1000) : 50;
    const context = buildSessionContext(entries as never, leafId, {
      deferThinking,
      deferToolResultImages,
      tail,
      sessionId: id, // local: lazy URLs for historical tool-result images
    });
    const totalActiveMs = computeSessionTotalActiveMs(entries);
    // Cumulative usage over ALL entries, including history compacted away —
    // the same aggregation the SDK's getSessionStats() uses. Lets the client
    // keep monotonic token/cost counters across compaction and page reloads.
    const stats = computeSessionStats(entries as unknown as SessionEntry[]);
    const sessionName = sm.getSessionName();
    const firstUserEntry = entries.find((entry) => entry.type === "message" && entry.message.role === "user");
    const firstUserMessage = firstUserEntry?.type === "message" ? firstUserEntry.message : undefined;

    const header = sm.getHeader();
    let modified = header?.timestamp ?? new Date().toISOString();
    try { modified = statSync(filePath).mtime.toISOString(); } catch { /* use header timestamp */ }
    const parentSessionId = header?.parentSession
      ? await resolveSessionIdByPath(header.parentSession)
      : undefined;
    const typedEntries = entries as unknown as SessionEntry[];
    const subagent = header
      ? readSubagentRun(typedEntries, header.id, filePath)
      : null;
    const consultation = readConsultationMetadata(typedEntries);
    const toolNames = readSubagentSessionResources(typedEntries)?.tools
      ?? readSessionToolSelection(typedEntries);
    const relation = buildSessionRelation({
      consultation,
      subagent,
      subagentStatus: liveRpc?.isRunning() ? "running" : undefined,
      parentSessionPath: header?.parentSession,
      originSessionId: parentSessionId,
    });
    const relationParentId = relation && "parentSessionId" in relation
      ? relation.parentSessionId
      : parentSessionId;
    const info = header ? (await attachSessionProjectInfo([{
      path: filePath,
      id: header.id,
      cwd: header.cwd ?? "",
      name: sessionName,
      created: header.timestamp,
      modified,
      messageCount: stats.totalMessages,
      firstMessage: firstUserMessage
        ? (() => {
            const c = (firstUserMessage as { content: unknown }).content;
            return typeof c === "string" ? c : (Array.isArray(c) ? (c.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "" : "") || "(no messages)";
          })()
        : "(no messages)",
      ...(relationParentId ? { parentSessionId: relationParentId } : {}),
      ...(relation ? { relation } : {}),
      transient: !filePath || !existsSync(filePath),
    }]))[0] : null;

    return NextResponse.json({
      sessionId: id,
      filePath,
      info,
      leafId,
      tree,
      context,
      stats,
      totalActiveMs,
      ...(toolNames !== undefined ? { toolNames } : {}),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH /api/sessions/[id]  body: { name: string }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { name } = await req.json() as { name?: string };
    if (typeof name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const sm = SessionManager.open(filePath);
    sm.appendSessionInfo(name.trim());
    invalidateSessionListCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/sessions/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Read only the bounded header before deleting.
    let parentSessionPath: string | undefined;
    try {
      parentSessionPath = readSessionHeader(filePath)?.parentSession;
    } catch (error) {
      // Empty runtime sessions have a cached path before their first disk write.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    let parentSessionId: string | undefined;
    if (parentSessionPath) {
      try {
        // The parent may have been deleted or moved already; treat it as absent.
        parentSessionId = readSessionHeader(parentSessionPath)?.id;
      } catch {
        parentSessionId = undefined;
      }
    }

    // Consultation children are durable user-facing history, so deleting a
    // parent cascades them instead of silently re-parenting them. Ordinary
    // fork/subagent children retain the historical re-parent behavior.
    const targetPathKey = sessionPathKey(filePath);
    const dir = dirname(filePath);
    const consultationPaths = new Set<string>();
    const childRecords: Array<{
      path: string;
      id?: string;
      parentSession?: string;
      consultation: boolean;
      lines: string[];
    }> = [];
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter(
        (file) => file.endsWith(".jsonl") && sessionPathKey(join(dir, file)) !== targetPathKey,
      );
      for (const file of files) {
        const childPath = join(dir, file);
        try {
          const content = readFileSync(childPath, "utf8");
          const lines = content.split("\n");
          const header = JSON.parse(lines[0]) as { type?: string; id?: string; parentSession?: string };
          if (header.type !== "session" || !header.parentSession) continue;
          const entries = lines.slice(1).flatMap((line) => {
            try { return [JSON.parse(line) as SessionEntry]; } catch { return []; }
          });
          childRecords.push({
            path: childPath,
            id: header.id,
            parentSession: header.parentSession,
            consultation: Boolean(readConsultationMetadata(entries)),
            lines,
          });
        } catch { /* skip malformed */ }
      }
    } catch {
      // If the directory cannot be scanned, retain the historical behavior of
      // deleting the requested session and leave unrelated files untouched.
    }

    const recordByPath = new Map(childRecords.map((record) => [sessionPathKey(record.path), record]));
    const collectConsultationDescendants = (parentPath: string) => {
      for (const record of childRecords) {
        if (!record.parentSession || sessionPathKey(record.parentSession) !== sessionPathKey(parentPath)) continue;
        if (!record.consultation || consultationPaths.has(record.path)) continue;
        consultationPaths.add(record.path);
        collectConsultationDescendants(record.path);
      }
    };
    collectConsultationDescendants(filePath);
    const consultationPathKeys = new Set([...consultationPaths].map((path) => sessionPathKey(path)));
    const parentIdByPath = new Map<string, string>();
    for (const record of childRecords) {
      if (record.id) parentIdByPath.set(sessionPathKey(record.path), record.id);
    }

    const survivingParent = (originalParentPath: string): { path?: string; id?: string } => {
      let candidate = originalParentPath;
      const visited = new Set<string>();
      while (consultationPathKeys.has(sessionPathKey(candidate)) && !visited.has(sessionPathKey(candidate))) {
        visited.add(sessionPathKey(candidate));
        const deletedParent = recordByPath.get(sessionPathKey(candidate));
        if (!deletedParent?.parentSession) return {};
        candidate = deletedParent.parentSession;
      }
      if (sessionPathKey(candidate) === targetPathKey) {
        return {
          ...(parentSessionPath ? { path: parentSessionPath } : {}),
          ...(parentSessionId ? { id: parentSessionId } : {}),
        };
      }
      const parentId = parentIdByPath.get(sessionPathKey(candidate));
      return { path: candidate, ...(parentId ? { id: parentId } : {}) };
    };

    // Reparent ordinary fork/subagent children of the deleted session and of
    // deleted consultation descendants. Consultation children themselves are
    // removed below rather than silently attached to an ancestor.
    for (const record of childRecords) {
      if (consultationPathKeys.has(sessionPathKey(record.path)) || !record.parentSession) continue;
      const originalParentKey = sessionPathKey(record.parentSession);
      if (originalParentKey !== targetPathKey && !consultationPathKeys.has(originalParentKey)) continue;
      const nextParent = survivingParent(record.parentSession);
      let header: { type?: string; parentSession?: string };
      try {
        header = JSON.parse(record.lines[0]);
      } catch {
        continue;
      }
      if (nextParent.path) header.parentSession = nextParent.path;
      else delete header.parentSession;
      record.lines[0] = JSON.stringify(header);
      if (nextParent.path && nextParent.id) {
        for (let index = 1; index < record.lines.length; index += 1) {
          let entry: { type?: string; customType?: string; data?: unknown };
          try {
            entry = JSON.parse(record.lines[index]);
          } catch {
            continue;
          }
          if (
            entry.type !== "custom"
            || entry.customType !== SUBAGENT_META_TYPE
            || typeof entry.data !== "object"
            || entry.data === null
            || Array.isArray(entry.data)
          ) continue;
          entry.data = {
            ...entry.data,
            parentSessionId: nextParent.id,
            parentSessionPath: nextParent.path,
          };
          record.lines[index] = JSON.stringify(entry);
          break;
        }
      }
      writeFileSync(record.path, record.lines.join("\n"));
    }

    // Delete deepest consultation children first so every descendant is
    // removed even when the parent is also the target session.
    for (const consultationPath of [...consultationPaths].reverse()) {
      const record = recordByPath.get(sessionPathKey(consultationPath));
      if (record?.id) {
        await getRpcSession(record.id)?.shutdown();
        invalidateSessionPathCache(record.id);
      }
      try { unlinkSync(consultationPath); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }

    await getRpcSession(id)?.shutdown();
    try {
      unlinkSync(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    invalidateSessionPathCache(id);
    invalidateSessionListCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
