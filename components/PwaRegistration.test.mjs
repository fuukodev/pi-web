import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./PwaRegistration.tsx", import.meta.url), "utf8");

test("dev unregisters leftover production service workers", () => {
  assert.match(source, /process\.env\.NODE_ENV !== "production"/);
  assert.match(source, /navigator\.serviceWorker\.getRegistrations\(\)/);
  assert.match(source, /registration\.unregister\(\)/);
  const devGuardIndex = source.indexOf('process.env.NODE_ENV !== "production"');
  const registerIndex = source.indexOf("navigator.serviceWorker.register");
  assert.ok(devGuardIndex > 0 && registerIndex > devGuardIndex, "dev path must run before and instead of registration");
});

test("production still registers the versioned service worker", () => {
  assert.match(source, /navigator\.serviceWorker\.register\(scriptUrl/);
  assert.match(source, /updateViaCache: "none"/);
});
