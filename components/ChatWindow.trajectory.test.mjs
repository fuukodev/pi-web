import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("keeps the trajectory hook mounted while switching between chat and trajectory", () => {
  assert.match(source, /<TrajectoryPane[\s\S]*enabled=\{viewMode === "trajectory"\}[\s\S]*\/>\s*\{viewMode === "trajectory" \? null : <>/);
});
