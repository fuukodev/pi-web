import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

// next.config.ts must stay importable as plain Node ESM (lib/next-config-esm.test.mjs),
// so it declares the rewrite inline; NODE_ENV must be set for the `rewrites()` call,
// not only for the import, because Next evaluates it lazily. The query string busts
// Node's module cache so dev and production are evaluated independently.
async function loadRewrites(nodeEnv) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;
  try {
    const config = (await import(`../next.config.ts?env=${nodeEnv}`)).default;
    return await config.rewrites();
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

async function loadModule(pathEntry) {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  return jiti.import(pathEntry);
}

const {
  DEV_SERVICE_WORKER_SOURCE,
  DEV_SW_RESET_SCRIPT,
} = await loadModule("../lib/dev-service-worker.ts");

function evaluateWorkerSource() {
  const listeners = new Map();
  const calls = [];
  const deletedKeys = [];
  let unregistered = 0;

  const selfStub = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    skipWaiting: () => calls.push("skipWaiting"),
    registration: { unregister: async () => { unregistered += 1; return true; } },
    clients: { claim: async () => calls.push("claim") },
  };
  const cachesStub = {
    keys: async () => ["pi-web-static-0.9.1", "unrelated"],
    delete: async (key) => { deletedKeys.push(key); return true; },
  };

  // The worker source runs at global scope in a browser; feed it test-scope globals.
  new Function("self", "caches", DEV_SERVICE_WORKER_SOURCE)(selfStub, cachesStub);

  return {
    calls,
    deletedKeys,
    unregistered: () => unregistered,
    dispatch: (type) => {
      let pending;
      listeners.get(type)({ waitUntil: (promise) => { pending = promise; } });
      return pending;
    },
  };
}

function runResetScript({ registrations = [], cacheKeys = [], stored = null, storageThrows = false }) {
  const unregistered = [];
  const deleted = [];
  const storage = new Map();
  if (stored !== null) storage.set("pi-web-dev-sw-reset", stored);
  let reloads = 0;

  const sessionStorage = {
    getItem: (key) => {
      if (storageThrows) throw new Error("storage blocked");
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem: (key, value) => {
      if (storageThrows) throw new Error("storage blocked");
      storage.set(key, value);
    },
    removeItem: (key) => {
      if (storageThrows) throw new Error("storage blocked");
      storage.delete(key);
    },
  };

  new Function("navigator", "caches", "sessionStorage", "location", DEV_SW_RESET_SCRIPT)(
    {
      serviceWorker: {
        getRegistrations: async () => registrations.map((id) => ({
          unregister: async () => { unregistered.push(id); return true; },
        })),
      },
    },
    {
      keys: async () => cacheKeys,
      delete: async (key) => { deleted.push(key); return true; },
    },
    sessionStorage,
    { reload: () => { reloads += 1; } },
  );

  return {
    unregistered,
    deleted,
    reloads: () => reloads,
    marker: () => (storage.has("pi-web-dev-sw-reset") ? storage.get("pi-web-dev-sw-reset") : null),
    // The script resolves through a couple of promise hops.
    settle: async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    },
  };
}

test("next.config.ts rewrites /sw.js to the neutralizing route only in development", async () => {
  assert.deepEqual(await loadRewrites("development"), {
    beforeFiles: [{ source: "/sw.js", destination: "/api/dev-sw" }],
  });

  assert.deepEqual(await loadRewrites("production"), []);
});

test("the dev worker clears every cache and unregisters itself", async () => {
  const worker = evaluateWorkerSource();

  await worker.dispatch("install");
  assert.deepEqual(worker.calls, ["skipWaiting"]);

  await worker.dispatch("activate");
  assert.deepEqual(worker.deletedKeys, ["pi-web-static-0.9.1", "unrelated"]);
  assert.equal(worker.unregistered(), 1);
  assert.deepEqual(worker.calls, ["skipWaiting", "claim"]);
});

test("the reset script unregisters workers, clears caches, and reloads once", async () => {
  const run = runResetScript({
    registrations: ["registration-1"],
    cacheKeys: ["pi-web-static-0.9.1"],
  });
  await run.settle();

  assert.deepEqual(run.unregistered, ["registration-1"]);
  assert.deepEqual(run.deleted, ["pi-web-static-0.9.1"]);
  assert.equal(run.reloads(), 1);
  // The marker survives the reload, so a second dirty load cannot loop.
  assert.equal(run.marker(), "1");
});

test("the reset script does not reload twice for the same tab", async () => {
  const run = runResetScript({
    registrations: ["registration-1"],
    cacheKeys: [],
    stored: "1",
  });
  await run.settle();

  assert.deepEqual(run.unregistered, ["registration-1"]);
  assert.equal(run.reloads(), 0);
});

test("a clean origin drops the marker so the next production run self-heals", async () => {
  const run = runResetScript({ registrations: [], cacheKeys: [], stored: "1" });
  await run.settle();

  assert.equal(run.reloads(), 0);
  assert.equal(run.marker(), null);
});

test("blocked storage still cleans up, without risking a reload loop", async () => {
  const run = runResetScript({
    registrations: ["registration-1"],
    cacheKeys: ["pi-web-static-0.9.1"],
    storageThrows: true,
  });
  await run.settle();

  assert.deepEqual(run.unregistered, ["registration-1"]);
  assert.deepEqual(run.deleted, ["pi-web-static-0.9.1"]);
  assert.equal(run.reloads(), 0);
});

test("layout renders the reset script only while developing", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(
    layout,
    /process\.env\.NODE_ENV === "development" && \([\s\S]{0,160}DEV_SW_RESET_SCRIPT/,
  );
  assert.match(layout, /__html: THEME_INIT_SCRIPT/);
});

test("the dev route serves the worker in development and 404s in production", async () => {
  const { GET } = await loadModule("../app/api/dev-sw/route.ts");
  const previous = process.env.NODE_ENV;

  try {
    process.env.NODE_ENV = "development";
    const dev = await GET();
    assert.equal(dev.status, 200);
    assert.match(dev.headers.get("Content-Type"), /application\/javascript/);
    assert.equal(dev.headers.get("Cache-Control"), "no-store");
    assert.match(await dev.text(), /unregister/);

    process.env.NODE_ENV = "production";
    const prod = await GET();
    assert.equal(prod.status, 404);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
