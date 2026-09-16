import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath, sliceActiveBranch } from "@/lib/session-reader";
import type { SessionEntry } from "@/lib/types";
import {
  buildTrajectoryRecordDetail,
  TrajectoryDetailError,
} from "@/lib/trajectory/detail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_TRAJECTORY_ID_LENGTH = 256;

function readOptionalId(value: string | null, name: string): string | undefined {
  if (value === null) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > MAX_TRAJECTORY_ID_LENGTH || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new TrajectoryDetailError("invalid_query", `${name} is invalid`);
  }
  return normalized;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;
  if (!entryId || entryId.length > MAX_TRAJECTORY_ID_LENGTH || /[\u0000-\u001f\u007f]/u.test(entryId)) {
    return NextResponse.json({ error: "Trajectory record not found" }, { status: 404 });
  }
  const url = new URL(req.url);
  let leafId: string | undefined;
  let toolCallId: string | undefined;
  let recordId: string | undefined;
  try {
    leafId = readOptionalId(url.searchParams.get("leafId"), "leafId");
    toolCallId = readOptionalId(url.searchParams.get("toolCallId"), "toolCallId");
    recordId = readOptionalId(url.searchParams.get("recordId"), "recordId");
  } catch (error) {
    const message = error instanceof TrajectoryDetailError ? error.message : "Invalid trajectory query";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const filePath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sm = liveRpc?.inner.sessionManager ?? SessionManager.open(filePath!);
    const entries = sm.getEntries() as SessionEntry[];
    const requestedLeafId = leafId ?? sm.getLeafId();
    const branch = sliceActiveBranch(entries, requestedLeafId, Math.max(entries.length, 1));
    if (requestedLeafId && branch.at(-1)?.id !== requestedLeafId) {
      return NextResponse.json({ error: "Trajectory record not found" }, { status: 404 });
    }

    let toolSchema: unknown;
    if (liveRpc && toolCallId) {
      const toolBlock = branch
        .filter((entry): entry is Extract<SessionEntry, { type: "message" }> => entry.type === "message" && entry.message.role === "assistant")
        .flatMap((entry) => entry.message.role === "assistant" && Array.isArray(entry.message.content) ? entry.message.content : [])
        .find((block) => block.type === "toolCall" && (block.toolCallId === toolCallId || (block as unknown as { id?: string }).id === toolCallId));
      const rawToolBlock = toolBlock as unknown as { toolName?: string; name?: string } | undefined;
      const toolName = rawToolBlock?.toolName ?? rawToolBlock?.name;
      if (toolName) {
        toolSchema = liveRpc.inner.getAllTools().find((tool) => tool.name === toolName)?.parameters;
      }
    }
    const detail = buildTrajectoryRecordDetail(branch, entryId, toolCallId, recordId, toolSchema);
    return NextResponse.json(detail, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof TrajectoryDetailError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "invalid_query" ? 400 : 404 },
      );
    }
    return NextResponse.json({ error: "Unable to load trajectory record" }, { status: 500 });
  }
}
