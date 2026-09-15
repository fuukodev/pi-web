import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const query = await jiti.import("./search-query.ts");

test("parses and rewrites type prefixes without server dependencies", () => {
  assert.deepEqual(query.parseTrajectorySearchQuery("th: parser"), { type: "thinking", term: "parser" });
  assert.equal(query.withTrajectorySearchType("tool: parser", "assistant"), "assistant: parser");
});

test("the shared query module stays dependency-free for client bundles", async () => {
  const source = await readFile(new URL("./search-query.ts", import.meta.url), "utf8");
  const imports = source.match(/^import .*$/gm) ?? [];
  assert.deepEqual(imports, ['import type { TrajectoryRecord } from "./types";']);
  assert.doesNotMatch(source, /session-reader|node:/);
});

test("client modules never import the server-only search scanner", async () => {
  const files = [
    new URL("../../hooks/useTrajectorySearch.ts", import.meta.url),
    new URL("../../components/trajectory/TrajectorySearch.tsx", import.meta.url),
    new URL("../../components/trajectory/TrajectoryPane.tsx", import.meta.url),
  ];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /from "@\/lib\/trajectory\/search"/, file.pathname);
    assert.match(source, /@\/lib\/trajectory\/search-query/, file.pathname);
  }
});
