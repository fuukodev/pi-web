import { join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

/**
 * Pi's *global* startup defaults, stored in `~/.pi/agent/settings.json`.
 *
 * These fields are shared with the `pi` CLI and TUI: changing them here changes
 * what every new pi session starts with, including sessions outside Pi Web.
 * Pi Web therefore edits them only from the explicit Settings → Models →
 * Defaults panel — never from the chat composer, which is session-scoped.
 */

export interface PiGlobalDefaults {
  defaultProvider: string | null;
  defaultModel: string | null;
  defaultThinkingLevel: ThinkingLevel | null;
}

export interface PiGlobalDefaultsUpdate {
  provider?: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
}

/**
 * Non-fatal diagnostics returned when saving defaults. Codes stay stable so the
 * UI owns the wording; `detail` carries the values it interpolates.
 */
export type SettingsWarningCode = "unsupported_thinking_level";

export interface SettingsWarning {
  code: SettingsWarningCode;
  detail: string;
}

export const PI_THINKING_LEVELS: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const THINKING_LEVEL_SET = new Set<string>(PI_THINKING_LEVELS);

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && THINKING_LEVEL_SET.has(value);
}

export function getPiGlobalSettingsPath(agentDir: string = getAgentDir()): string {
  return join(agentDir, "settings.json");
}

/**
 * `cwd` only chooses which project settings file gets merged in. The defaults
 * panel reads and writes the global scope, so passing the agent dir keeps that
 * merge inert and keeps this helper independent of the active project.
 */
function createGlobalSettingsManager(agentDir: string): SettingsManager {
  return SettingsManager.create(agentDir, agentDir);
}

function readGlobalScope(manager: SettingsManager): PiGlobalDefaults {
  const global = manager.getGlobalSettings();
  return {
    defaultProvider: typeof global.defaultProvider === "string" ? global.defaultProvider : null,
    defaultModel: typeof global.defaultModel === "string" ? global.defaultModel : null,
    defaultThinkingLevel: isThinkingLevel(global.defaultThinkingLevel) ? global.defaultThinkingLevel : null,
  };
}

/** Surface a corrupt file instead of silently reporting empty defaults. */
function throwGlobalError(manager: SettingsManager): void {
  const failure = manager.drainErrors().find((entry) => entry.scope === "global");
  if (failure) throw failure.error;
}

export function readPiGlobalDefaults(agentDir: string = getAgentDir()): PiGlobalDefaults {
  const manager = createGlobalSettingsManager(agentDir);
  throwGlobalError(manager);
  return readGlobalScope(manager);
}

/**
 * Update pi's global startup defaults through the SDK's settings manager, which
 * takes the same file lock and merges the same fields the `pi` CLI writes. A
 * hand-rolled read/modify/write here would drop a concurrent TUI edit.
 */
export async function writePiGlobalDefaults(
  update: PiGlobalDefaultsUpdate,
  agentDir: string = getAgentDir(),
): Promise<PiGlobalDefaults> {
  const manager = createGlobalSettingsManager(agentDir);
  throwGlobalError(manager);

  if (update.provider !== undefined && update.modelId !== undefined) {
    manager.setDefaultModelAndProvider(update.provider, update.modelId);
  }
  if (update.thinkingLevel !== undefined) {
    manager.setDefaultThinkingLevel(update.thinkingLevel);
  }

  await manager.flush();
  throwGlobalError(manager);
  return readGlobalScope(manager);
}
