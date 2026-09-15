import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const routeSource = await readFile(new URL("./[id]/trajectory/route.ts", import.meta.url), "utf8");
const query = await createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
}).import("@/lib/trajectory/query");

test("trajectory route reads live sessions before requiring a persisted path", () => {
  assert.match(routeSource, /getRpcSession\(id\)/);
  assert.match(routeSource, /const liveRpc = rpc\?\.isAlive\(\) \? rpc : undefined/);
  assert.ok(routeSource.indexOf("getRpcSession(id)") < routeSource.indexOf("resolveSessionPath(id)"));
  assert.match(routeSource, /liveRpc\?\.inner\.sessionManager \?\? SessionManager\.open/);
  assert.match(routeSource, /buildTrajectoryPage\(sm\.getEntries\(\) as SessionEntry\[\]/);
});

test("trajectory route validates bounded pagination and maps query failures to 400", () => {
  assert.match(routeSource, /const DEFAULT_TRAJECTORY_PAGE_LIMIT = 20/);
  assert.match(routeSource, /TRAJECTORY_PAGE_LIMIT_MAX/);
  assert.match(routeSource, /status: 400/);
  assert.match(routeSource, /TrajectoryQueryError/);
  assert.match(routeSource, /Cache-Control.*no-store/);
  assert.equal(query.TRAJECTORY_PAGE_LIMIT_MAX, 50);
});

test("trajectory route does not expose unexpected internal errors", () => {
  assert.match(routeSource, /Unable to load trajectory/);
  assert.doesNotMatch(routeSource, /NextResponse\.json\(\{ error: String\(error\) \}/);
});
