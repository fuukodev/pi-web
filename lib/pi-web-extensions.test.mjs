import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  registerPiWebLlamaProvider,
  withPiWebBuiltInExtensions,
  withPiWebLlamaProvider,
} = await jiti.import("./pi-web-extensions.ts");

test("resolves the shipped llama files without bundler-unsafe import.meta.resolve", () => {
  const source = readFileSync(new URL("./pi-web-extensions.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /import\.meta\.resolve/);
  assert.match(source, /findPackageJSON/);
  assert.match(source, /pathToFileURL/);
});

test("adds the llama.cpp extension without dropping caller factories", () => {
  const customFactory = () => {};
  const options = withPiWebBuiltInExtensions({ extensionFactories: [customFactory] });

  assert.equal(options.extensionFactories.length, 2);
  assert.equal(options.extensionFactories[1], customFactory);
});

test("model and settings services use the Pi Web built-in extensions", () => {
  const modelsRoute = readFileSync(new URL("../app/api/models/route.ts", import.meta.url), "utf8");
  const settingsRoute = readFileSync(new URL("../app/api/settings/route.ts", import.meta.url), "utf8");
  const authProvidersRoute = readFileSync(new URL("../app/api/auth/providers/route.ts", import.meta.url), "utf8");
  const apiKeyRoute = readFileSync(new URL("../app/api/auth/api-key/[provider]/route.ts", import.meta.url), "utf8");

  assert.match(modelsRoute, /withPiWebLlamaProvider\(/);
  assert.match(modelsRoute, /refreshPiWebLlamaModels\(/);
  assert.match(settingsRoute, /withPiWebLlamaProvider\(/);
  assert.match(settingsRoute, /refreshPiWebLlamaModels\(/);
  assert.match(authProvidersRoute, /registerPiWebLlamaProvider\(/);
  assert.match(apiKeyRoute, /registerPiWebLlamaProvider\(/);
  assert.match(apiKeyRoute, /serverUrl/);
});

test("auth runtimes can register the llama.cpp provider without a resource loader", async () => {
  const providers = [];
  await registerPiWebLlamaProvider({ registerNativeProvider: (provider) => providers.push(provider) });

  assert.equal(providers.length, 1);
  assert.equal(providers[0].id, "llama.cpp");
  assert.ok(providers[0].auth.apiKey?.login);
});

test("provider-only resource options do not expose the interactive llama command", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-llama-provider-agent-"));
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-llama-provider-cwd-"));

  try {
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      resourceLoaderOptions: withPiWebLlamaProvider({
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      }),
    });

    const extension = services.resourceLoader.extensionsResult.extensions.find(
      (entry) => entry.path === "<inline:llama.cpp>",
    );
    assert.ok(extension);
    assert.equal(extension.commands.size, 0);
    assert.ok(services.modelRuntime.getProvider("llama.cpp"));
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
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
