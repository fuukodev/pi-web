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
    getAuth: async () => ({ auth: { baseUrl: "http://127.0.0.1:8080/v1" } }),
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

test("does not repeatedly refresh a known empty catalog", async () => {
  let refreshes = 0;
  const runtime = {
    getProvider: () => ({ getModels: () => [] }),
    hasConfiguredAuth: () => true,
    getAuth: async () => ({ auth: { baseUrl: "http://empty-catalog-host:8080/v1" } }),
    refresh: async () => { refreshes += 1; },
  };

  await refreshPiWebLlamaModels(runtime);
  await refreshPiWebLlamaModels(runtime);

  assert.equal(refreshes, 1);
});

test("refreshes when the cached catalog belongs to another server", async () => {
  const calls = [];
  const registered = [];
  const provider = { getModels: () => [{ baseUrl: "http://old-host:8080/v1" }] };
  const runtime = {
    getProvider: () => provider,
    hasConfiguredAuth: () => true,
    getAuth: async () => ({ auth: { baseUrl: "http://new-host:8080/v1" } }),
    refresh: async (options) => { calls.push(options); },
    registerNativeProvider: (next) => { registered.push(next); },
  };

  await refreshPiWebLlamaModels(runtime);

  assert.equal(calls.length, 1);
  assert.equal(registered.length, 1);
  assert.deepEqual(registered[0].getModels(), []);
});

test("does not refresh when llama.cpp is absent or already cached", async () => {
  for (const runtime of [
    {
      getProvider: () => undefined,
      hasConfiguredAuth: () => true,
      refresh: async () => { throw new Error("must not refresh"); },
    },
    {
      getProvider: () => ({ getModels: () => [{ baseUrl: "http://127.0.0.1:8080/v1" }] }),
      hasConfiguredAuth: () => true,
      getAuth: async () => ({ auth: { baseUrl: "http://127.0.0.1:8080/v1" } }),
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
