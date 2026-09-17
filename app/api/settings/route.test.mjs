import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = mkdtempSync(join(tmpdir(), "pi-web-settings-route-agent-"));
const cwd = mkdtempSync(join(tmpdir(), "pi-web-settings-route-cwd-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

writeFileSync(join(agentDir, "models.json"), JSON.stringify({
  providers: {
    acme: {
      api: "openai-completions",
      baseUrl: "https://acme.example.test/v1",
      apiKey: "test-key",
      models: [
        { id: "acme-large", name: "Acme Large", reasoning: true },
        { id: "acme-small", name: "Acme Small", reasoning: true },
      ],
    },
  },
}, null, 2), "utf8");

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, PUT } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("@/lib/file-access");
allowFileRoot(cwd);

after(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function get(search = "") {
  return GET(new Request(`http://localhost/api/settings${search}`, {
    headers: { Host: "localhost" },
  }));
}

function put(body, contentType = "application/json") {
  return PUT(new Request("http://localhost/api/settings", {
    method: "PUT",
    headers: { "Content-Type": contentType, Host: "localhost" },
    body: JSON.stringify(body),
  }));
}

function readSettings() {
  return JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
}

test("GET reports unset defaults before anything is saved", async () => {
  const response = await get();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    defaultProvider: null,
    defaultModel: null,
    defaultThinkingLevel: null,
  });
});

test("PUT rejects malformed and unknown inputs", async () => {
  let response = await put({ provider: "acme" });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "provider and modelId must be provided together" });

  response = await put({ provider: "acme", modelId: "acme-large", thinkingLevel: "turbo" });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Invalid thinking level/);

  response = await put({});
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "provider/modelId or thinkingLevel is required" });

  response = await put({ provider: "acme", modelId: "does-not-exist", cwd });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Model not found: acme/does-not-exist" });

  response = await put({ provider: "acme", modelId: "acme-large" }, "text/plain");
  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), { error: "Content-Type must be application/json" });
});

test("PUT writes the selected model and thinking level to the global settings file", async () => {
  const response = await put({ provider: "acme", modelId: "acme-large", thinkingLevel: "high", cwd });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.defaultProvider, "acme");
  assert.equal(body.defaultModel, "acme-large");
  assert.equal(body.defaultThinkingLevel, "high");
  assert.deepEqual(body.effectiveModel, { provider: "acme", modelId: "acme-large" });
  assert.equal(body.warnings, undefined);

  const file = readSettings();
  assert.equal(file.defaultProvider, "acme");
  assert.equal(file.defaultModel, "acme-large");
  assert.equal(file.defaultThinkingLevel, "high");
});

test("PUT warns when the selected model does not support the thinking level", async () => {
  const response = await put({ provider: "acme", modelId: "acme-large", thinkingLevel: "max", cwd });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.warnings?.length, 1);
  assert.equal(body.warnings[0].code, "unsupported_thinking_level");
  assert.equal(body.warnings[0].model, "acme/acme-large");
  assert.equal(body.warnings[0].level, "max");
  assert.ok(body.warnings[0].supported.includes("high"));
  assert.ok(!body.warnings[0].supported.includes("max"));
  assert.equal(readSettings().defaultThinkingLevel, "max");
});

test("a model change alone reports the pinned level the saved default cannot take", async () => {
  // "max" is already pinned; selecting a model that cannot take it must warn
  // without the client comparing thinking-level lists itself.
  const response = await put({ provider: "acme", modelId: "acme-small", cwd });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.warnings?.map((warning) => warning.code), ["unsupported_thinking_level"]);
  assert.equal(body.warnings[0].model, "acme/acme-small");
  assert.equal(body.warnings[0].level, "max");

  await put({ provider: "acme", modelId: "acme-large", cwd });
});

test("a thinking-level-only change is judged against the saved model", async () => {
  const response = await put({ thinkingLevel: "max", cwd });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.warnings?.map((warning) => warning.code), ["unsupported_thinking_level"]);
  assert.equal(body.warnings[0].model, "acme/acme-large");

  const supported = await put({ thinkingLevel: "high", cwd });
  assert.deepEqual((await supported.json()).warnings, undefined);
});

test("an unresolvable saved default never blocks a thinking-level change", async () => {
  const original = readSettings();
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
    ...original,
    defaultProvider: "gone",
    defaultModel: "gone-model",
  }, null, 2), "utf8");

  const response = await put({ thinkingLevel: "low", cwd });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.defaultThinkingLevel, "low");
  assert.equal(body.defaultProvider, "gone");
  assert.deepEqual(body.warnings, undefined);

  writeFileSync(join(agentDir, "settings.json"), JSON.stringify(original, null, 2), "utf8");
});

test("PUT accepts a thinking-level-only change and keeps the model", async () => {
  const response = await put({ thinkingLevel: "low" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    defaultProvider: "acme",
    defaultModel: "acme-large",
    defaultThinkingLevel: "low",
  });

  const file = readSettings();
  assert.equal(file.defaultProvider, "acme");
  assert.equal(file.defaultModel, "acme-large");
  assert.equal(file.defaultThinkingLevel, "low");
});

test("GET reflects the saved defaults", async () => {
  const response = await get();
  assert.deepEqual(await response.json(), {
    defaultProvider: "acme",
    defaultModel: "acme-large",
    defaultThinkingLevel: "low",
  });
});

test("GET reports warnings for the saved defaults", async () => {
  await put({ provider: "acme", modelId: "acme-large", thinkingLevel: "max", cwd });

  const response = await get(`?cwd=${encodeURIComponent(cwd)}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.defaultModel, "acme-large");
  assert.deepEqual(body.warnings?.map((warning) => warning.code), ["unsupported_thinking_level"]);
  assert.equal(body.warnings[0].level, "max");
  assert.ok(body.warnings[0].supported.includes("high"));
  assert.ok(!body.warnings[0].supported.includes("max"));

  // A read must survive an unusable cwd: no warnings, no failure, no project
  // extension execution.
  const denied = await get(`?cwd=${encodeURIComponent(tmpdir())}`);
  assert.equal(denied.status, 200);
  assert.deepEqual((await denied.json()).warnings, undefined);
});
