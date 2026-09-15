import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeSource = await readFile(new URL("./[id]/trajectory/records/[entryId]/route.ts", import.meta.url), "utf8");

test("trajectory detail route validates the selected active branch", () => {
  assert.match(routeSource, /sliceActiveBranch\(/);
  assert.match(routeSource, /buildTrajectoryRecordDetail\(/);
  assert.match(routeSource, /leafId = readOptionalId/);
  assert.match(routeSource, /TrajectoryDetailError/);
  assert.match(routeSource, /status: 404/);
});

test("trajectory detail route prefers live sessions and never accepts a file path", () => {
  assert.match(routeSource, /getRpcSession\(id\)/);
  assert.ok(routeSource.indexOf("getRpcSession(id)") < routeSource.indexOf("resolveSessionPath(id)"));
  assert.match(routeSource, /liveRpc\?\.inner\.sessionManager \?\? SessionManager\.open/);
  assert.doesNotMatch(routeSource, /searchParams\.get\("filePath"\)/);
  assert.match(routeSource, /Cache-Control.*no-store/);
});

test("trajectory detail route uses generic errors for unexpected failures", () => {
  assert.match(routeSource, /Unable to load trajectory record/);
  assert.doesNotMatch(routeSource, /NextResponse\.json\(\{ error: String\(error\) \}/);
});
