import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

/**
 * Every thinking level the UI can offer, including "auto" — which means "leave
 * pi's own setting alone" and is therefore only valid where a caller can be
 * silent about the level (the chat composer), never as a stored value.
 *
 * Shared so a thinking-level control anywhere in the app labels levels the same
 * way, instead of one of them falling back to bare identifiers.
 */
export const THINKING_LEVEL_OPTIONS = [
  "auto",
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ThinkingLevelOption = (typeof THINKING_LEVEL_OPTIONS)[number];

/** i18n key for the human-readable description shown next to a level. */
export const THINKING_LEVEL_DESC_KEYS: Record<ThinkingLevelOption, string> = {
  auto: "chat.thinkingUseDefault",
  off: "chat.thinkingOff",
  minimal: "chat.thinkingMinimal",
  low: "chat.thinkingLow",
  medium: "chat.thinkingMedium",
  high: "chat.thinkingHigh",
  xhigh: "chat.thinkingXhigh",
  max: "chat.thinkingMax",
};

/** Concrete levels, i.e. everything a stored thinking level can be. */
export const STORED_THINKING_LEVELS: readonly ThinkingLevel[] = THINKING_LEVEL_OPTIONS.filter(
  (level): level is ThinkingLevel => level !== "auto",
);
