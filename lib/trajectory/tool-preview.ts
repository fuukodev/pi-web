const MAX_VALUE_LENGTH = 60;
const MAX_ARGUMENTS = 3;

/**
 * Arguments readers look for first. Everything else follows the order the model
 * emitted, so unknown tools still show something meaningful.
 */
const PRIORITY_KEYS = [
  "command",
  "path",
  "file_path",
  "pattern",
  "query",
  "url",
  "prompt",
  "description",
] as const;

export const MAX_TOOL_PREVIEW_LENGTH = 240;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    const collapsed = collapse(value);
    const clipped = collapsed.length > MAX_VALUE_LENGTH
      ? `${collapsed.slice(0, MAX_VALUE_LENGTH - 1)}…`
      : collapsed;
    return JSON.stringify(clipped);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length === 0 ? "[]" : `[${value.length} items]`;
  if (typeof value === "object") return "{…}";
  return JSON.stringify(String(value));
}

/**
 * Builds a compact `name(key=value, …)` call signature for a trajectory tool
 * record. The ledger shows what the model asked for; the result stays in the
 * inspector instead of replacing the call preview.
 */
export function formatToolCallPreview(toolName: string, input: unknown): string {
  const name = toolName.trim();
  if (!name || !isRecord(input)) return name;

  const keys = Object.keys(input);
  const ordered = [
    ...PRIORITY_KEYS.filter((key) => keys.includes(key)),
    ...keys.filter((key) => !(PRIORITY_KEYS as readonly string[]).includes(key)),
  ];

  const values: string[] = [];
  let capped = false;
  for (const key of ordered) {
    const value = input[key];
    if (value === undefined) continue;
    if (values.length >= MAX_ARGUMENTS) {
      capped = true;
      break;
    }
    values.push(`${key}=${formatValue(value)}`);
  }
  if (values.length === 0) return name;

  // Add arguments while the closing parenthesis and ellipsis still fit, so the
  // preview never grows past the shared ledger limit.
  let included: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const more = index < values.length - 1 || capped;
    const candidate = [...included, values[index]];
    const text = `${name} (${candidate.join(", ")}${more ? ", …" : ""})`;
    if (text.length <= MAX_TOOL_PREVIEW_LENGTH) included = candidate;
    else break;
  }

  const head = `${name} (${values[0]}`;
  if (included.length === 0) {
    return head.length + 3 <= MAX_TOOL_PREVIEW_LENGTH
      ? `${head}…)`
      : `${head.slice(0, MAX_TOOL_PREVIEW_LENGTH - 3)}…)`;
  }
  const more = included.length < values.length || capped;
  return `${name} (${included.join(", ")}${more ? ", …" : ""})`;
}
