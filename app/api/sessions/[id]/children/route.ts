import { NextResponse } from "next/server";
import {
  attachSessionProjectInfo,
  listAllSessions,
  mergeSessionLists,
} from "@/lib/session-reader";
import { getRpcSessionInfos } from "@/lib/rpc-manager";
import {
  ConsultationInputError,
  createConsultationSession,
} from "@/lib/consultation-runtime";

export const dynamic = "force-dynamic";

const DEFAULT_CHILDREN_LIMIT = 50;
const MAX_CHILDREN_LIMIT = 100;

async function allSessionInfos() {
  const [persisted, runtime] = await Promise.all([
    listAllSessions(),
    attachSessionProjectInfo(getRpcSessionInfos()),
  ]);
  return mergeSessionLists(persisted, runtime);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: parentSessionId } = await params;
  try {
    const search = new URL(req.url).searchParams;
    const kind = search.get("kind");
    if (kind && kind !== "consultation") {
      return NextResponse.json({ error: "Unsupported child kind" }, { status: 400 });
    }
    const rawLimit = Number(search.get("limit"));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_CHILDREN_LIMIT)
      : DEFAULT_CHILDREN_LIMIT;
    const sessions = await allSessionInfos();
    const parentExists = sessions.some((session) => session.id === parentSessionId);
    if (!parentExists) return NextResponse.json({ error: "Session not found", code: "SESSION_NOT_FOUND" }, { status: 404 });

    const children = sessions
      .filter((session) => (
        session.relation?.kind === "consultation"
        && session.relation.parentSessionId === parentSessionId
      ))
      .sort((a, b) => b.modified.localeCompare(a.modified));
    const cursor = search.get("cursor");
    const cursorIndex = cursor ? children.findIndex((child) => child.id === cursor) : -1;
    if (cursor && cursorIndex < 0) {
      return NextResponse.json({ error: "Unknown pagination cursor", code: "CONSULTATION_INVALID_CURSOR" }, { status: 400 });
    }
    const start = cursorIndex < 0 ? 0 : cursorIndex + 1;
    const page = children.slice(start, start + limit);
    const nextCursor = start + limit < children.length ? page.at(-1)?.id : undefined;
    return NextResponse.json({
      parentSessionId,
      children: page,
      ...(nextCursor ? { nextCursor } : {}),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[pi-web] failed to list consultation children:", error);
    return NextResponse.json({ error: "Unable to list consultation children", code: "CONSULTATION_LIST_FAILED" }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: parentSessionId } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body", code: "CONSULTATION_INVALID" }, { status: 400 });
  }
  try {
    const result = await createConsultationSession(parentSessionId, body);
    return NextResponse.json({
      sessionId: result.sessionId,
      parentSessionId: result.parentSessionId,
      contextMode: result.contextMode,
      source: result.source,
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ConsultationInputError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("[pi-web] failed to start consultation:", error);
    return NextResponse.json({ error: "Unable to start consultation", code: "CONSULTATION_CREATE_FAILED" }, { status: 500 });
  }
}
