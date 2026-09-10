import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { existsSync, unlinkSync } from "fs";
import {
  buildConsultationPrompt,
  buildConsultationTurnContext,
  boundConsultationTurnContext,
  CONSULTATION_META_TYPE,
  CONSULTATION_PROMPT_VERSION,
  MAX_CONSULTATION_CONTEXT_CHARS,
  MAX_CONSULTATION_QUESTION_CHARS,
  MAX_CONSULTATION_SELECTION_CHARS,
  truncateConsultationExcerpt,
  type ConsultationSourceSelection,
} from "./session-consultation";
import {
  cacheSessionPath,
  invalidateSessionListCache,
  invalidateSessionPathCache,
  resolveSessionPath,
} from "./session-reader";
import { getRpcSession, startRpcSession } from "./rpc-manager";
import type {
  ConsultationContextMode,
  ConsultationSourceKind,
  SessionEntry,
} from "./types";

const SOURCE_KINDS = new Set<ConsultationSourceKind>([
  "assistant_text",
  "thinking",
  "tool_call",
  "tool_result",
]);

const ERROR_CODES_BY_STATUS: Record<400 | 404 | 409 | 500, string> = {
  400: "CONSULTATION_INVALID",
  404: "SESSION_NOT_FOUND",
  409: "CONSULTATION_CONFLICT",
  500: "CONSULTATION_CREATE_FAILED",
};

export interface ConsultationRequest {
  contextMode: ConsultationContextMode;
  question: string;
  source: {
    kind: ConsultationSourceKind;
    entryId: string;
    blockIndex: number;
    text: string;
  };
}

export class ConsultationInputError extends Error {
  readonly code: string;

  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 500 = 400,
    code = ERROR_CODES_BY_STATUS[status],
  ) {
    super(message);
    this.name = "ConsultationInputError";
    this.code = code;
  }
}

export interface ConsultationSessionResult {
  sessionId: string;
  sessionFile: string;
  parentSessionId: string;
  prompt: string;
  contextMode: ConsultationContextMode;
  source: ConsultationSourceSelection;
}

function isContextMode(value: unknown): value is ConsultationContextMode {
  return value === "selection" || value === "turn";
}

function isSourceKind(value: unknown): value is ConsultationSourceKind {
  return typeof value === "string" && SOURCE_KINDS.has(value as ConsultationSourceKind);
}

function validateRequest(value: unknown): ConsultationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConsultationInputError("Consultation request must be an object");
  }
  const body = value as Record<string, unknown>;
  const sourceValue = body.source;
  if (!isContextMode(body.contextMode) || !sourceValue || typeof sourceValue !== "object" || Array.isArray(sourceValue)) {
    throw new ConsultationInputError("contextMode and source are required");
  }
  const source = sourceValue as Record<string, unknown>;
  if (!isSourceKind(source.kind)) throw new ConsultationInputError("Unsupported consultation source kind");
  if (typeof source.entryId !== "string" || source.entryId.length === 0 || source.entryId.length > 256) {
    throw new ConsultationInputError("source.entryId is required");
  }
  if (!Number.isInteger(source.blockIndex) || (source.blockIndex as number) < 0 || (source.blockIndex as number) > 10_000) {
    throw new ConsultationInputError("source.blockIndex is invalid");
  }
  if (typeof source.text !== "string" || source.text.trim().length === 0) {
    throw new ConsultationInputError("source.text is required");
  }
  if (typeof body.question !== "string" || body.question.trim().length === 0) {
    throw new ConsultationInputError("question is required");
  }
  const question = body.question.trim();
  if (question.length > MAX_CONSULTATION_QUESTION_CHARS) {
    throw new ConsultationInputError("question is too long");
  }
  const text = source.text.trim();
  if (text.length > MAX_CONSULTATION_SELECTION_CHARS) {
    throw new ConsultationInputError("selected output is too long");
  }
  return {
    contextMode: body.contextMode,
    question,
    source: {
      kind: source.kind,
      entryId: source.entryId,
      blockIndex: source.blockIndex as number,
      text,
    },
  };
}

function currentParentState(parent: ReturnType<typeof getRpcSession>, manager: SessionManager): {
  model?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
} {
  if (parent?.isAlive()) {
    const model = parent.inner.model;
    const thinkingLevel = parent.inner.agent.state?.thinkingLevel;
    return {
      ...(model ? { model: { provider: model.provider, modelId: model.id } } : {}),
      ...(typeof thinkingLevel === "string" ? { thinkingLevel: thinkingLevel as ThinkingLevel } : {}),
    };
  }
  const context = manager.buildSessionContext();
  const model = context.model;
  const thinkingLevel = context.thinkingLevel;
  return {
    ...(model ? { model } : {}),
    ...(typeof thinkingLevel === "string" ? { thinkingLevel: thinkingLevel as ThinkingLevel } : {}),
  };
}

/** Creates and starts one persisted consultation child without modifying the parent. */
export async function createConsultationSession(
  parentSessionId: string,
  rawRequest: unknown,
): Promise<ConsultationSessionResult> {
  const request = validateRequest(rawRequest);
  const parent = getRpcSession(parentSessionId);
  const parentFile = parent?.isAlive() ? parent.sessionFile : await resolveSessionPath(parentSessionId);
  if (!parentFile || !existsSync(parentFile)) {
    throw new ConsultationInputError("The parent session must be persisted before starting a consultation", 409);
  }

  const parentManager = parent?.isAlive()
    ? parent.inner.sessionManager
    : SessionManager.open(parentFile);
  const parentHeader = parentManager.getHeader();
  if (!parentHeader) throw new ConsultationInputError("Parent session not found", 404);
  const parentEntries = parentManager.getEntries() as unknown as SessionEntry[];
  const source: ConsultationSourceSelection = {
    kind: request.source.kind,
    entryId: request.source.entryId,
    blockIndex: request.source.blockIndex,
    excerpt: truncateConsultationExcerpt(request.source.text),
  };
  const selectedText = request.source.text;
  const reconstructedTurn = buildConsultationTurnContext(parentEntries, parentManager.getLeafId(), source);
  if (reconstructedTurn.length === 0 || !reconstructedTurn.some((block) => block.selected)) {
    throw new ConsultationInputError("The selected output is no longer available in the parent session", 409);
  }
  const turnContext = request.contextMode === "turn"
    ? boundConsultationTurnContext(reconstructedTurn, MAX_CONSULTATION_CONTEXT_CHARS)
    : undefined;

  const prompt = buildConsultationPrompt({
    contextMode: request.contextMode,
    selected: { kind: request.source.kind, text: selectedText },
    ...(turnContext ? { turnContext } : {}),
    question: request.question,
  });
  const parentState = currentParentState(parent, parentManager);
  const childManager = SessionManager.create(parentHeader.cwd, undefined, { parentSession: parentFile });
  const sessionId = childManager.getSessionId();
  const sessionFile = childManager.getSessionFile();
  if (!sessionFile) throw new ConsultationInputError("Unable to allocate consultation session", 500);

  const createdAt = new Date().toISOString();
  childManager.appendCustomEntry(CONSULTATION_META_TYPE, {
    version: 1,
    parentSessionId: parentHeader.id,
    parentSessionPath: parentFile,
    contextMode: request.contextMode,
    source,
    promptVersion: CONSULTATION_PROMPT_VERSION,
    createdAt,
  });
  childManager.appendSessionInfo(truncateConsultationExcerpt(request.question, 96));

  cacheSessionPath(sessionId, sessionFile);
  let started: Awaited<ReturnType<typeof startRpcSession>> | undefined;
  try {
    started = await startRpcSession(sessionId, sessionFile, parentHeader.cwd, {
      toolNames: [],
      consultation: true,
      ...(parentState.model ? { initialModel: parentState.model } : {}),
      ...(parentState.thinkingLevel ? { thinkingLevel: parentState.thinkingLevel } : {}),
    });
    await started.session.send({ type: "prompt", message: prompt });
  } catch (error) {
    try {
      await started?.session.shutdown();
    } catch (cleanupError) {
      console.error("[pi-web] failed to shut down consultation after startup error:", cleanupError);
    }
    try {
      unlinkSync(sessionFile);
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("[pi-web] failed to remove consultation after startup error:", cleanupError);
      }
    }
    invalidateSessionPathCache(sessionId);
    invalidateSessionListCache();
    throw error;
  }
  invalidateSessionListCache();

  return {
    sessionId: started.realSessionId,
    sessionFile: started.session.sessionFile,
    parentSessionId: parentHeader.id,
    prompt,
    contextMode: request.contextMode,
    source,
  };
}
