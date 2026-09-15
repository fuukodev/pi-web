import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useTrajectorySearch.ts", import.meta.url), "utf8");

test("searches only while open with a non-empty term", () => {
  assert.match(source, /if \(!enabled \|\| !open \|\| !sessionId \|\| !term\)/);
  assert.match(source, /\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/trajectory\/search\?/);
  assert.match(source, /setTimeout/);
  assert.match(source, /clearTimeout/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /controller\.abort\(\)/);
});

test("maps the parsed prefix and selector onto the types parameter", () => {
  assert.match(source, /parseTrajectorySearchQuery/);
  assert.match(source, /withTrajectorySearchType/);
  assert.match(source, /params\.set\("types", type\)/);
  assert.match(source, /params\.set\("leafId", activeLeafId\)/);
});

test("clears results and text when the search closes", () => {
  assert.match(source, /if \(open\) return/);
  assert.match(source, /setQuery\(""\)/);
  assert.match(source, /setResults\(\[\]\)/);
});
