import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { withPiWebBuiltInExtensions } = await jiti.import("./pi-web-extensions.ts");

test("adds the llama.cpp extension without dropping caller factories", () => {
  const customFactory = () => {};
  const options = withPiWebBuiltInExtensions({ extensionFactories: [customFactory] });

  assert.equal(options.extensionFactories.length, 2);
  assert.equal(options.extensionFactories[1], customFactory);
});

test("model and settings services use the Pi Web built-in extensions", () => {
  const modelsRoute = readFileSync(new URL("../app/api/models/route.ts", import.meta.url), "utf8");
  const settingsRoute = readFileSync(new URL("../app/api/settings/route.ts", import.meta.url), "utf8");

  assert.match(modelsRoute, /withPiWebBuiltInExtensions\(/);
  assert.match(modelsRoute, /refreshPiWebLlamaModels\(/);
  assert.match(settingsRoute, /withPiWebBuiltInExtensions\(/);
  assert.match(settingsRoute, /refreshPiWebLlamaModels\(/);
});

test("the Pi Web resource options register the llama.cpp provider", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-llama-agent-"));
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-llama-cwd-"));

  try {
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      resourceLoaderOptions: withPiWebBuiltInExtensions({
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      }),
    });

    assert.ok(services.modelRuntime.getProvider("llama.cpp"));
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});
