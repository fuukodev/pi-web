import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const routeSource = await readFile(new URL("./[id]/trajectory/search/route.ts", import.meta.url), "utf8");
const search = await createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
}).import("@/lib/trajectory/search");

test("trajectory search route reads live sessions before requiring a persisted path", () => {
  assert.match(routeSource, /getRpcSession\(id\)/);
  assert.match(routeSource, /const liveRpc = rpc\?\.isAlive\(\) \? rpc : undefined/);
  assert.ok(routeSource.indexOf("getRpcSession(id)") < routeSource.indexOf("resolveSessionPath(id)"));
  assert.match(routeSource, /liveRpc\?\.inner\.sessionManager \?\? SessionManager\.open/);
  assert.match(routeSource, /buildTrajectorySearch\(\s*sm\.getEntries\(\) as SessionEntry\[\]/);
});

test("trajectory search route validates the query, types, and limit with a 400", () => {
  assert.match(routeSource, /searchParams\.get\("q"\)/);
  assert.match(routeSource, /searchParams\.get\("types"\)/);
  assert.match(routeSource, /TRAJECTORY_SEARCH_LIMIT_MAX/);
  assert.match(routeSource, /status: 400/);
  assert.match(routeSource, /TrajectorySearchError/);
  assert.match(routeSource, /Cache-Control.*no-store/);
  assert.equal(search.TRAJECTORY_SEARCH_QUERY_MAX, 200);
  assert.deepEqual(search.TRAJECTORY_SEARCH_TYPES, ["user", "assistant", "thinking", "tool"]);
});

test("trajectory search route never accepts a file path and hides internal errors", () => {
  assert.doesNotMatch(routeSource, /searchParams\.get\("filePath"\)/);
  assert.match(routeSource, /Unable to search trajectory/);
  assert.doesNotMatch(routeSource, /NextResponse\.json\(\{ error: String\(error\) \}/);
});
