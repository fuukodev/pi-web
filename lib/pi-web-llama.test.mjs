import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { refreshPiWebLlamaModels } = await jiti.import("./pi-web-llama.ts");

test("refreshes an authenticated llama.cpp provider when no cached models exist", async () => {
  const calls = [];
  const runtime = {
    getProvider: (id) => id === "llama.cpp" ? { getModels: () => [] } : undefined,
    hasConfiguredAuth: (id) => id === "llama.cpp",
    refresh: async (options) => {
      calls.push(options);
      return { aborted: false, errors: new Map() };
    },
  };

  await refreshPiWebLlamaModels(runtime);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].providers, ["llama.cpp"]);
  assert.equal(calls[0].allowNetwork, true);
  assert.ok(calls[0].signal instanceof AbortSignal);
});

test("does not refresh when llama.cpp is absent or already cached", async () => {
  for (const runtime of [
    {
      getProvider: () => undefined,
      hasConfiguredAuth: () => true,
      refresh: async () => { throw new Error("must not refresh"); },
    },
    {
      getProvider: () => ({ getModels: () => [{ id: "cached" }] }),
      hasConfiguredAuth: () => true,
      refresh: async () => { throw new Error("must not refresh"); },
    },
    {
      getProvider: () => ({ getModels: () => [] }),
      hasConfiguredAuth: () => false,
      refresh: async () => { throw new Error("must not refresh"); },
    },
  ]) {
    await refreshPiWebLlamaModels(runtime);
  }
});
