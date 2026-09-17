import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

/**
 * Chat-side selections must never reach pi's global defaults.
 *
 * This drives a real AgentSession end to end (unlike the source-shape checks in
 * rpc-manager.test.mjs) because the regression was behavioral: `initialModel`
 * was applied *and* persisted, so a session looked correct while
 * `~/.pi/agent/settings.json` was silently rewritten.
 */

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = mkdtempSync(join(tmpdir(), "pi-web-rpc-defaults-agent-"));
const cwd = mkdtempSync(join(tmpdir(), "pi-web-rpc-defaults-cwd-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

writeFileSync(join(agentDir, "models.json"), JSON.stringify({
  providers: {
    acme: {
      api: "openai-completions",
      baseUrl: "https://acme.example.test/v1",
      apiKey: "test-key",
      models: [
        { id: "acme-small", name: "Acme Small" },
        { id: "acme-large", name: "Acme Large", reasoning: true },
      ],
    },
  },
}, null, 2), "utf8");

// The saved default stays acme-small; every assertion below proves the session
// can run on something else without touching this file.
const savedSettings = {
  defaultProvider: "acme",
  defaultModel: "acme-small",
  theme: "dark",
};
writeFileSync(join(agentDir, "settings.json"), JSON.stringify(savedSettings, null, 2), "utf8");

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
});
const { startRpcSession, setRpcSessionTools, destroyRpcSessionsForCwd } =
  await jiti.import("./rpc-manager.ts");

const settingsPath = join(agentDir, "settings.json");
const settingsBefore = readFileSync(settingsPath, "utf8");

after(async () => {
  await destroyRpcSessionsForCwd(cwd);
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function assertGlobalDefaultsUntouched(action) {
  assert.equal(
    readFileSync(settingsPath, "utf8"),
    settingsBefore,
    `settings.json changed after ${action}`,
  );
}

test("session model and thinking selections stay session-scoped", async () => {
  const { session, realSessionId } = await startRpcSession(`__defaults__${Date.now()}`, "", cwd, {
    toolNames: [],
    initialModel: { provider: "acme", modelId: "acme-large" },
    thinkingLevel: "high",
  });

  const state = await session.send({ type: "get_state" });
  assert.deepEqual(state.model, { id: "acme-large", provider: "acme" });
  assert.equal(state.thinkingLevel, "high");
  assertGlobalDefaultsUntouched("new-session startup");
  assert.equal(existsSync(session.sessionFile ?? ""), false, "precondition: the session file is not flushed yet");

  // Crossing the Chat-only boundary rebuilds the wrapper. That rebuild passes
  // the session's own model as `initialModel`, which used to be persisted too.
  const rebuilt = await setRpcSessionTools(realSessionId, session.sessionFile ?? null, ["read", "bash"]);
  assert.equal(rebuilt.recreated, true);
  const rebuiltState = await rebuilt.session.send({ type: "get_state" });
  assert.deepEqual(rebuiltState.model, { id: "acme-large", provider: "acme" });
  assert.equal(rebuiltState.thinkingLevel, "high");
  assertGlobalDefaultsUntouched("tool-preset rebuild");

  const switched = await rebuilt.session.send({ type: "set_model", provider: "acme", modelId: "acme-large" });
  assert.deepEqual(switched, { id: "acme-large", provider: "acme" });
  assertGlobalDefaultsUntouched("set_model");

  await rebuilt.session.send({ type: "set_thinking_level", level: "low" });
  assertGlobalDefaultsUntouched("set_thinking_level");

  assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), savedSettings);
});
