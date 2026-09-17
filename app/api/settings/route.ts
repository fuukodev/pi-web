import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { createAgentSessionServices, getAgentDir } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { invalidateModelsCache } from "@/lib/models-cache";
import { resolveVisibleModels, selectInitialModelScope } from "@/lib/model-scope";
import { isThinkingLevel, readPiGlobalDefaults, writePiGlobalDefaults, type SettingsWarning } from "@/lib/pi-settings";
import { projectTrustReloadOptions } from "@/lib/project-trust";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * Pi's global startup defaults (`~/.pi/agent/settings.json`).
 *
 * Pi Web edits these only from the explicit Settings → Models → Defaults panel.
 * The chat composer is session-scoped and must never rewrite them, so this
 * route is the single auditable write path (see lib/rpc-manager.ts startup).
 */

export type { SettingsWarningCode } from "@/lib/pi-settings";

interface ValidationCwd {
  cwd: string;
}

async function resolveValidationCwd(value: unknown): Promise<ValidationCwd | NextResponse> {
  // Without a cwd the server validates against its own directory, which needs no
  // allow-list entry. A client-supplied cwd must already be browsable.
  if (value === undefined || value === null || value === "") return { cwd: process.cwd() };
  if (typeof value !== "string") {
    return NextResponse.json({ error: "cwd must be a string" }, { status: 400 });
  }

  const cwd = resolve(value);
  let stats;
  try {
    stats = await stat(cwd);
  } catch {
    return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
  }
  if (!stats.isDirectory()) {
    return NextResponse.json({ error: `Not a directory: ${cwd}` }, { status: 400 });
  }

  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  return { cwd };
}

/**
 * Resolve the model the same way the model list and AgentSession startup do:
 * through cwd-bound services, so extension-registered providers are visible
 * here too. Otherwise a model the selector offers would be rejected on save.
 *
 * `effectiveModel` reports what a new session would actually start with once
 * the enabledModels scope and configured auth are applied; it differs from the
 * saved default whenever that default would be skipped at startup.
 */
async function resolveModel(
  cwd: string,
  provider: string,
  modelId: string,
): Promise<{ model?: Model<Api>; effectiveModel: { provider: string; modelId: string } | null }> {
  const agentDir = getAgentDir();
  const trustReloadOptions = projectTrustReloadOptions(cwd, agentDir);
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
  });

  let model = services.modelRuntime.getModel(provider, modelId);
  if (!model) {
    await services.modelRuntime.refresh({ allowNetwork: false });
    model = services.modelRuntime.getModel(provider, modelId);
  }
  if (!model) return { effectiveModel: null };

  const scope = await resolveVisibleModels(
    services.modelRuntime,
    services.settingsManager.getEnabledModels(),
  );
  const initial = selectInitialModelScope(scope, { defaultModel: { provider, modelId } });
  return {
    model,
    effectiveModel: initial.model
      ? { provider: initial.model.provider, modelId: initial.model.id }
      : null,
  };
}

export async function GET() {
  try {
    return NextResponse.json(readPiGlobalDefaults());
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

    const warnings: SettingsWarning[] = [];
    let effectiveModel: { provider: string; modelId: string } | null = null;
    if (provider && modelId) {
      const cwd = await resolveValidationCwd(body.cwd);
      if (cwd instanceof NextResponse) return cwd;

      const resolved = await resolveModel(cwd.cwd, provider, modelId);
      if (!resolved.model) {
        return NextResponse.json({ error: `Model not found: ${provider}/${modelId}` }, { status: 400 });
      }
      effectiveModel = resolved.effectiveModel;
      const supported = getSupportedThinkingLevels(resolved.model);
      if (thinkingLevel && !supported.includes(thinkingLevel)) {
        warnings.push({ code: "unsupported_thinking_level", detail: supported.join(", ") });
      }
    }

    const saved = await writePiGlobalDefaults({
      ...(provider && modelId ? { provider, modelId } : {}),
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
