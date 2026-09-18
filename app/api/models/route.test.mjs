import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = mkdtempSync(join(tmpdir(), "pi-web-models-route-agent-"));
const cwd = mkdtempSync(join(tmpdir(), "pi-web-models-route-cwd-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
mkdirSync(cwd, { recursive: true });

writeFileSync(join(agentDir, "auth.json"), JSON.stringify({
  "llama.cpp": {
    type: "api_key",
    key: "local",
    env: { LLAMA_BASE_URL: "http://127.0.0.1:8080" },
  },
}), "utf8");
writeFileSync(join(agentDir, "models-store.json"), JSON.stringify({
  "llama.cpp": {
    checkedAt: Date.now(),
    models: [{
      id: "loaded-model",
      name: "loaded-model",
      api: "openai-completions",
      provider: "llama.cpp",
      baseUrl: "http://127.0.0.1:8080/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32768,
      maxTokens: 32768,
      compat: { maxTokensField: "max_tokens" },
    }],
  },
}), "utf8");

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("@/lib/file-access");
allowFileRoot(cwd);

after(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

test("GET includes cached llama.cpp models in the selectable model list", async () => {
  const response = await GET(new Request(
    `http://localhost/api/models?cwd=${encodeURIComponent(cwd)}`,
  ));

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(
    body.modelList.filter((model) => model.provider === "llama.cpp").map((model) => model.id),
    ["loaded-model"],
  );
});
