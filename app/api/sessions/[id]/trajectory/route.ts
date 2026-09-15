import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";
import type { SessionEntry } from "@/lib/types";
import {
  buildTrajectoryPage,
  TRAJECTORY_PAGE_LIMIT_MAX,
  TrajectoryQueryError,
} from "@/lib/trajectory/query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_TRAJECTORY_PAGE_LIMIT = 20;
const MAX_TRAJECTORY_ID_LENGTH = 256;

function readOptionalId(value: string | null, name: "leafId" | "cursor" | "anchor"): string | undefined {
  if (value === null) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > MAX_TRAJECTORY_ID_LENGTH || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    const code = name === "leafId" ? "invalid_leaf" : name === "cursor" ? "invalid_cursor" : "invalid_anchor";
    throw new TrajectoryQueryError(code, `${name} is invalid`);
  }
  return normalized;
}

function readLimit(value: string | null): number {
  if (value === null || value === "") return DEFAULT_TRAJECTORY_PAGE_LIMIT;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > TRAJECTORY_PAGE_LIMIT_MAX) {
    throw new TrajectoryQueryError("invalid_limit", "limit is invalid");
  }
  return parsed;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);

  let leafId: string | undefined;
  let cursor: string | undefined;
  let anchor: string | undefined;
  let limit: number;
  try {
    leafId = readOptionalId(url.searchParams.get("leafId"), "leafId");
    cursor = readOptionalId(url.searchParams.get("cursor"), "cursor");
    anchor = readOptionalId(url.searchParams.get("anchor"), "anchor");
    limit = readLimit(url.searchParams.get("limit"));
  } catch (error) {
    const message = error instanceof TrajectoryQueryError ? error.message : "Invalid trajectory query";
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
    const page = buildTrajectoryPage(sm.getEntries() as SessionEntry[], leafId ?? sm.getLeafId(), {
      limit,
      cursor,
      anchorTurnId: anchor,
    });
    return NextResponse.json(page, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof TrajectoryQueryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to load trajectory" }, { status: 500 });
  }
}
