import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildLiveTrajectoryRecords } = await jiti.import("./live.ts");

function starts(overrides = {}) {
  return {
    assistant: 1000,
    bash: 1100,
    compaction: 1200,
    tools: new Map([["tc1", 1300]]),
    ...overrides,
  };
}

test("projects streaming assistant, tools, bash, and compaction as live records", () => {
  const records = buildLiveTrajectoryRecords({
    now: 5000,
    starts: starts(),
    agentRunning: true,
    bashRunning: true,
    isCompacting: true,
    pendingBash: { command: "npm test", excludeFromContext: false },
    agentPhase: { kind: "running_tools", tools: [{ id: "tc1", name: "read", progress: "loading" }] },
    activeToolResults: new Map([["tc1", { isError: true, content: [{ type: "text", text: "fetch failed" }] }]]),
    liveUserMessage: "inspect the project",
    streamState: {
      isStreaming: true,
      streamingMessage: {
        role: "assistant",
        provider: "test",
        model: "test-model",
        timestamp: 123,
        content: [{ type: "text", text: "partial answer" }],
      },
    },
  });

  assert.deepEqual(records.map((record) => record.kind), ["user", "assistant", "tool", "bash", "compaction"]);
  assert.equal(records[1].status, "running");
  assert.equal(records[0].preview, "inspect the project");
  assert.equal(records[1].preview, "Loading…");
  assert.equal(records[1].durationMs, 4000);
  assert.equal(records[2].preview, "loading");
  assert.equal(records[2].status, "error");
  assert.equal(records[2].error, "fetch failed");
  assert.equal(records[3].summary, "npm test");
  assert.equal(records[4].summary, "Compaction");
});

test("shows a running assistant record while waiting for the model", () => {
  const records = buildLiveTrajectoryRecords({
    now: 5000,
    starts: starts({ assistant: 2500 }),
    agentRunning: true,
    bashRunning: false,
    isCompacting: false,
    pendingBash: null,
    agentPhase: { kind: "waiting_model" },
    liveUserMessage: "wait",
    streamState: { isStreaming: false, streamingMessage: null },
  });

  assert.deepEqual(records.map((record) => record.kind), ["user", "assistant"]);
  assert.equal(records[1].summary, "assistant");
  assert.equal(records[1].preview, "Loading…");
  assert.equal(records[1].durationMs, 2500);
});

test("shows an active slash-command phase as a live record", () => {
  const records = buildLiveTrajectoryRecords({
    now: 5000,
    starts: starts({ command: 1800 }),
    agentRunning: true,
    bashRunning: false,
    isCompacting: false,
    pendingBash: null,
    agentPhase: { kind: "running_command" },
    liveUserMessage: "run command",
    streamState: { isStreaming: false, streamingMessage: null },
  });

  assert.deepEqual(records.map((record) => record.kind), ["user", "assistant", "custom"]);
  assert.equal(records[2].summary, "Running command");
  assert.equal(records[2].durationMs, 3200);
});

test("shows an immediate assistant error instead of waiting for persistence", () => {
  const records = buildLiveTrajectoryRecords({
    now: 5000,
    starts: starts({ assistant: 2000 }),
    agentRunning: true,
    bashRunning: false,
    isCompacting: false,
    pendingBash: null,
    liveUserMessage: "fetch data",
    runError: "fetch failed",
    agentPhase: { kind: "waiting_model" },
    streamState: { isStreaming: false, streamingMessage: null },
  });

  const assistant = records.find((record) => record.kind === "assistant");
  assert.equal(assistant.status, "error");
  assert.equal(assistant.error, "fetch failed");
});

test("returns no live records when the session is idle", () => {
  assert.deepEqual(buildLiveTrajectoryRecords({
    now: 5000,
    starts: starts(),
    agentRunning: false,
    bashRunning: false,
    isCompacting: false,
    pendingBash: null,
    agentPhase: null,
    liveUserMessage: null,
    streamState: { isStreaming: false, streamingMessage: null },
  }), []);
});
