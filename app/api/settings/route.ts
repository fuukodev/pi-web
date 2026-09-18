import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { createAgentSessionServices, getAgentDir } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { invalidateModelsCache } from "@/lib/models-cache";
import { resolveVisibleModels, selectInitialModelScope } from "@/lib/model-scope";
import {
  isThinkingLevel,
  readPiGlobalDefaults,
  writePiGlobalDefaults,
  type PiGlobalDefaults,
  type SettingsWarning,
} from "@/lib/pi-settings";
import { projectTrustReloadOptions } from "@/lib/project-trust";
import { withPiWebBuiltInExtensions } from "@/lib/pi-web-extensions";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * Pi's global startup defaults (`~/.pi/agent/settings.json`).
 *
 * Pi Web edits these only from the explicit Settings → Models → Defaults panel.
 * The chat composer is session-scoped and must never rewrite them, so this
 * route is the single auditable write path (see lib/rpc-manager.ts startup).
 *
 * It is also the only judge of the diagnostics it reports: the model and its
 * supported thinking levels are resolved here, so clients render warnings
 * instead of re-deriving support from the model list.
 */

export type { SettingsWarningCode, SettingsWarning } from "@/lib/pi-settings";

interface ModelRef {
  provider: string;
  modelId: string;
}

interface ResolvedModel {
  /** Empty when the model does not exist in this runtime. */
  supported: string[];
  /** What a new session would actually start with after scope and auth. */
  effectiveModel: ModelRef | null;
}

type CwdResult = { cwd: string } | { error: string; status: number };

async function resolveValidationCwd(value: unknown): Promise<CwdResult> {
  // Without a cwd the server validates against its own directory, which needs no
  // allow-list entry. A client-supplied cwd must already be browsable.
  if (value === undefined || value === null || value === "") return { cwd: process.cwd() };
  if (typeof value !== "string") return { error: "cwd must be a string", status: 400 };

  const cwd = resolve(value);
  let stats;
  try {
    stats = await stat(cwd);
  } catch {
    return { error: `Directory does not exist: ${cwd}`, status: 400 };
  }
  if (!stats.isDirectory()) return { error: `Not a directory: ${cwd}`, status: 400 };

  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return { error: "Access denied", status: 403 };
  }
  return { cwd };
}

/**
 * Resolve a model the same way the model list and AgentSession startup do:
 * through cwd-bound services, so extension-registered providers are visible
 * here too. Otherwise a model the selector offers would be rejected on save.
 */
async function resolveModel(cwd: string, ref: ModelRef): Promise<ResolvedModel> {
  const agentDir = getAgentDir();
  const trustReloadOptions = projectTrustReloadOptions(cwd, agentDir);
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    resourceLoaderOptions: withPiWebBuiltInExtensions({}),
    ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
  });

  let model = services.modelRuntime.getModel(ref.provider, ref.modelId);
  if (!model) {
    await services.modelRuntime.refresh({ allowNetwork: false });
    model = services.modelRuntime.getModel(ref.provider, ref.modelId);
  }
  if (!model) return { supported: [], effectiveModel: null };

  const scope = await resolveVisibleModels(
    services.modelRuntime,
    services.settingsManager.getEnabledModels(),
  );
  const initial = selectInitialModelScope(scope, { defaultModel: ref });
  return {
    supported: getSupportedThinkingLevels(model),
    effectiveModel: initial.model
      ? { provider: initial.model.provider, modelId: initial.model.id }
      : null,
  };
}

/**
 * A pinned thinking level the model does not accept. pi clamps it per session,
 * so this is advisory: it never blocks the write.
 */
function unsupportedLevelWarning(
  ref: ModelRef,
  level: string | null | undefined,
  supported: readonly string[],
): SettingsWarning | undefined {
  if (!level || supported.length === 0 || supported.includes(level)) return undefined;
  return {
    code: "unsupported_thinking_level",
    model: `${ref.provider}/${ref.modelId}`,
    level: level as SettingsWarning["level"],
    supported,
  };
}

/**
 * Warnings for a model/level pair that comes from the saved settings rather than
 * the request. A default that no longer resolves (removed provider, expired
 * auth) must not become an error: the level itself is still writable.
 */
async function savedDefaultsWarnings(cwd: string, defaults: PiGlobalDefaults): Promise<SettingsWarning[]> {
  const ref = defaults.defaultProvider && defaults.defaultModel
    ? { provider: defaults.defaultProvider, modelId: defaults.defaultModel }
    : undefined;
  if (!ref || !defaults.defaultThinkingLevel) return [];

  try {
    const resolved = await resolveModel(cwd, ref);
    const warning = unsupportedLevelWarning(ref, defaults.defaultThinkingLevel, resolved.supported);
    return warning ? [warning] : [];
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  try {
    const defaults = readPiGlobalDefaults();
    const warnings: SettingsWarning[] = [];

    // A diagnostic must never make the saved defaults unreadable, and an
    // unauthorized cwd must never run a project's extension factories. Skip the
    // warning instead of failing the read.
    if (defaults.defaultProvider && defaults.defaultModel && defaults.defaultThinkingLevel) {
      const cwd = await resolveValidationCwd(new URL(req.url).searchParams.get("cwd"));
      if (!("error" in cwd)) warnings.push(...await savedDefaultsWarnings(cwd.cwd, defaults));
    }

    return NextResponse.json({
      ...defaults,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as Record<string, unknown>;

    const provider = typeof body.provider === "string" && body.provider.trim()
      ? body.provider.trim()
      : undefined;
    const modelId = typeof body.modelId === "string" && body.modelId.trim()
      ? body.modelId.trim()
      : undefined;
    if ((provider && !modelId) || (!provider && modelId)) {
      return NextResponse.json({ error: "provider and modelId must be provided together" }, { status: 400 });
    }

    if (body.thinkingLevel !== undefined && !isThinkingLevel(body.thinkingLevel)) {
      return NextResponse.json({ error: `Invalid thinking level: ${String(body.thinkingLevel)}` }, { status: 400 });
    }
    const thinkingLevel = isThinkingLevel(body.thinkingLevel) ? body.thinkingLevel : undefined;

    if (!provider && !thinkingLevel) {
      return NextResponse.json({ error: "provider/modelId or thinkingLevel is required" }, { status: 400 });
    }

    const previous = readPiGlobalDefaults();
    const requestedRef: ModelRef | undefined = provider && modelId ? { provider, modelId } : undefined;
    const savedRef: ModelRef | undefined = previous.defaultProvider && previous.defaultModel
      ? { provider: previous.defaultProvider, modelId: previous.defaultModel }
      : undefined;
    // The model and level in force after this write, whichever side changed.
    const levelAfterWrite = thinkingLevel ?? previous.defaultThinkingLevel ?? null;
    const modelAfterWrite = requestedRef ?? savedRef;

    const warnings: SettingsWarning[] = [];
    let effectiveModel: ModelRef | null = null;

    if (requestedRef) {
      const cwd = await resolveValidationCwd(body.cwd);
      if ("error" in cwd) return NextResponse.json({ error: cwd.error }, { status: cwd.status });

      const resolved = await resolveModel(cwd.cwd, requestedRef);
      if (resolved.supported.length === 0) {
        return NextResponse.json(
          { error: `Model not found: ${requestedRef.provider}/${requestedRef.modelId}` },
          { status: 400 },
        );
      }
      effectiveModel = resolved.effectiveModel;
      const warning = unsupportedLevelWarning(requestedRef, levelAfterWrite, resolved.supported);
      if (warning) warnings.push(warning);
    } else if (modelAfterWrite) {
      const cwd = await resolveValidationCwd(body.cwd);
      if ("error" in cwd) return NextResponse.json({ error: cwd.error }, { status: cwd.status });

      warnings.push(...await savedDefaultsWarnings(cwd.cwd, {
        defaultProvider: modelAfterWrite.provider,
        defaultModel: modelAfterWrite.modelId,
        defaultThinkingLevel: levelAfterWrite,
      }));
    }

    const saved = await writePiGlobalDefaults({
      ...(requestedRef ? { provider: requestedRef.provider, modelId: requestedRef.modelId } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    });
    invalidateModelsCache();

    return NextResponse.json({
      ...saved,
      ...(effectiveModel ? { effectiveModel } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
