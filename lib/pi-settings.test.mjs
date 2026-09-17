import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  getPiGlobalSettingsPath,
  readPiGlobalDefaults,
  writePiGlobalDefaults,
} = await jiti.import("./pi-settings.ts");

function createAgentDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-pi-settings-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function readSettingsFile(agentDir) {
  return JSON.parse(readFileSync(getPiGlobalSettingsPath(agentDir), "utf8"));
}

test("an absent settings file reads as unset defaults and is not created", (t) => {
  const agentDir = createAgentDir(t);

  assert.deepEqual(readPiGlobalDefaults(agentDir), {
    defaultProvider: null,
    defaultModel: null,
    defaultThinkingLevel: null,
  });
  assert.equal(existsSync(getPiGlobalSettingsPath(agentDir)), false);
});

test("writing defaults persists provider, model, and thinking level", async (t) => {
  const agentDir = createAgentDir(t);

  const saved = await writePiGlobalDefaults(
    { provider: "acme", modelId: "acme-large", thinkingLevel: "high" },
    agentDir,
  );

  assert.deepEqual(saved, {
    defaultProvider: "acme",
    defaultModel: "acme-large",
    defaultThinkingLevel: "high",
  });
  assert.deepEqual(readSettingsFile(agentDir), {
    defaultProvider: "acme",
    defaultModel: "acme-large",
    defaultThinkingLevel: "high",
  });
  assert.deepEqual(readPiGlobalDefaults(agentDir), saved);
});

test("a thinking-level-only write leaves the model and unrelated settings intact", async (t) => {
  const agentDir = createAgentDir(t);
  writeFileSync(getPiGlobalSettingsPath(agentDir), JSON.stringify({
    defaultProvider: "acme",
    defaultModel: "acme-large",
    defaultThinkingLevel: "low",
    theme: "dark",
    packages: ["npm:pi-subagents"],
  }, null, 2), "utf8");

  const saved = await writePiGlobalDefaults({ thinkingLevel: "xhigh" }, agentDir);

  assert.deepEqual(saved, {
    defaultProvider: "acme",
    defaultModel: "acme-large",
    defaultThinkingLevel: "xhigh",
  });
  const file = readSettingsFile(agentDir);
  assert.equal(file.theme, "dark");
  assert.deepEqual(file.packages, ["npm:pi-subagents"]);
});

test("a corrupt settings file fails loudly instead of reporting empty defaults", async (t) => {
  const agentDir = createAgentDir(t);
  writeFileSync(getPiGlobalSettingsPath(agentDir), "{ not json", "utf8");

  assert.throws(() => readPiGlobalDefaults(agentDir));
  await assert.rejects(() => writePiGlobalDefaults({ thinkingLevel: "high" }, agentDir));
});
