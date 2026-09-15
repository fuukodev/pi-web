import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";
import type { SessionEntry } from "@/lib/types";
import {
  buildTrajectorySearch,
  TRAJECTORY_SEARCH_LIMIT_MAX,
  TrajectorySearchError,
  type TrajectorySearchType,
} from "@/lib/trajectory/search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_TRAJECTORY_ID_LENGTH = 256;

function readOptionalId(value: string | null, name: "leafId"): string | undefined {
  if (value === null) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > MAX_TRAJECTORY_ID_LENGTH || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new TrajectorySearchError("invalid_query", `${name} is invalid`);
  }
  return normalized;
}

function readTypes(value: string | null): TrajectorySearchType[] | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) throw new TrajectorySearchError("invalid_query", "types is invalid");
  return parts as TrajectorySearchType[];
}

function readLimit(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > TRAJECTORY_SEARCH_LIMIT_MAX) {
    throw new TrajectorySearchError("invalid_query", "limit is invalid");
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
  let types: TrajectorySearchType[] | undefined;
  let limit: number | undefined;
  try {
    leafId = readOptionalId(url.searchParams.get("leafId"), "leafId");
    types = readTypes(url.searchParams.get("types"));
    limit = readLimit(url.searchParams.get("limit"));
  } catch (error) {
    const message = error instanceof TrajectorySearchError ? error.message : "Invalid trajectory query";
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
    const response = buildTrajectorySearch(
      sm.getEntries() as SessionEntry[],
      leafId ?? sm.getLeafId(),
      { query: url.searchParams.get("q") ?? "", types, limit },
    );
    return NextResponse.json(response, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof TrajectorySearchError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to search trajectory" }, { status: 500 });
  }
}
