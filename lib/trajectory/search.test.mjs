import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  buildTrajectorySearch,
  parseTrajectorySearchQuery,
  withTrajectorySearchType,
  TrajectorySearchError,
} = await jiti.import("./search.ts");

function user(id, parentId, content, timestamp = "2026-01-01T00:00:00.000Z") {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: { role: "user", content },
  };
}

function assistant(id, parentId, content, timestamp = "2026-01-01T00:00:01.000Z") {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: { role: "assistant", provider: "test", model: "test-model", content },
  };
}

const fixtures = () => [
  user("u1", null, "Please inspect the parser"),
  assistant("a1", "u1", [
    { type: "thinking", thinking: "The PARSER likely lives in lib." },
    { type: "toolCall", id: "tc1", name: "read", arguments: { path: "lib/parser.ts", limit: 50 } },
    { type: "text", text: "I read the parser file." },
  ]),
  user("u2", "a1", "now check the tokenizer"),
  assistant("a2", "u2", [
    { type: "toolCall", id: "tc2", name: "grep", arguments: { pattern: "tokenizer", path: "lib/" } },
    { type: "text", text: "The tokenizer looks fine." },
  ]),
];

test("matches user, assistant, and thinking content with distinct fields", () => {
  const response = buildTrajectorySearch(fixtures(), null, { query: "parser" });
  const byId = new Map(response.matches.map((match) => [match.record.id, match]));

  const userMatch = byId.get("entry:u1");
  assert.equal(userMatch.field, "text");
  assert.equal(userMatch.turnOrdinal, 1);

  const textMatch = byId.get("text:a1:2");
  assert.equal(textMatch.field, "text");
  assert.equal(textMatch.turnOrdinal, 1);

  const thinkingMatch = byId.get("thinking:a1");
  assert.equal(thinkingMatch.field, "thinking");
  assert.equal(thinkingMatch.record.kind, "thinking");
});

test("matches tool calls by name and by argument values", () => {
  const byName = buildTrajectorySearch(fixtures(), null, { query: "grep" });
  assert.deepEqual(byName.matches.map((match) => match.record.id), ["tool:a2:tc2"]);
  assert.equal(byName.matches[0].field, "toolName");

  const byArgument = buildTrajectorySearch(fixtures(), null, { query: "lib/parser.ts" });
  assert.deepEqual(byArgument.matches.map((match) => match.record.id), ["tool:a1:tc1"]);
  assert.equal(byArgument.matches[0].field, "toolInput");
});

test("filters by record type without leaking thinking into assistant matches", () => {
  const assistantOnly = buildTrajectorySearch(fixtures(), null, { query: "parser", types: ["assistant"] });
  assert.deepEqual(assistantOnly.matches.map((match) => match.record.id), ["text:a1:2"]);

  const thinkingOnly = buildTrajectorySearch(fixtures(), null, { query: "parser", types: ["thinking"] });
  assert.deepEqual(thinkingOnly.matches.map((match) => match.record.id), ["thinking:a1"]);

  const toolsOnly = buildTrajectorySearch(fixtures(), null, { query: "parser", types: ["tool"] });
  assert.deepEqual(toolsOnly.matches.map((match) => match.record.id), ["tool:a1:tc1"]);
});

test("matches case-insensitively and across collapsed whitespace", () => {
  const entries = [
    user("u1", null, "hello\n\n   world"),
    assistant("a1", "u1", [{ type: "text", text: "HeLLo World" }]),
  ];
  const response = buildTrajectorySearch(entries, null, { query: "HELLO world" });
  assert.deepEqual(response.matches.map((match) => match.record.id), ["text:a1:0", "entry:u1"]);
  assert.equal(response.matches[0].snippet, "HeLLo World");
});

test("orders matches newest first, applies the limit, and reports truncation", () => {
  const entries = [];
  let parentId = null;
  for (let index = 0; index < 5; index += 1) {
    const id = `u${index}`;
    entries.push(user(id, parentId, `needle ${index}`));
    parentId = id;
  }
  const response = buildTrajectorySearch(entries, null, { query: "needle", limit: 2 });
  assert.deepEqual(response.matches.map((match) => match.record.id), ["entry:u4", "entry:u3"]);
  assert.equal(response.total, 5);
  assert.equal(response.truncated, true);
  assert.deepEqual(response.types, ["user", "assistant", "thinking", "tool"]);
});

test("builds a windowed snippet around the match", () => {
  const body = `${"a".repeat(200)} needle ${"b".repeat(200)}`;
  const response = buildTrajectorySearch([user("u1", null, body)], null, { query: "needle" });
  assert.equal(response.matches.length, 1);
  const snippet = response.matches[0].snippet;
  assert.ok(snippet.includes("needle"), snippet);
  assert.ok(snippet.startsWith("…"), snippet);
  assert.ok(snippet.endsWith("…"), snippet);
  assert.ok(snippet.length < 140, `${snippet.length}`);
});

test("only searches records on the selected active branch", () => {
  const entries = [
    user("u1", null, "root message"),
    assistant("a1", "u1", [{ type: "text", text: "left branch" }]),
    assistant("a2", "u1", [{ type: "text", text: "right needle branch" }]),
  ];
  const response = buildTrajectorySearch(entries, "a2", { query: "needle" });
  assert.deepEqual(response.matches.map((match) => match.record.id), ["text:a2:0"]);
});

test("rejects invalid queries, types, and limits", () => {
  const entries = fixtures();
  const invalid = () => (error) => error instanceof TrajectorySearchError && error.code === "invalid_query";
  assert.throws(() => buildTrajectorySearch(entries, null, { query: "   " }), invalid());
  assert.throws(() => buildTrajectorySearch(entries, null, { query: "x".repeat(201) }), invalid());
  assert.throws(() => buildTrajectorySearch(entries, null, { query: "x", types: [] }), invalid());
  assert.throws(() => buildTrajectorySearch(entries, null, { query: "x", types: ["system"] }), invalid());
  assert.throws(() => buildTrajectorySearch(entries, null, { query: "x", limit: 0 }), invalid());
  assert.throws(() => buildTrajectorySearch(entries, null, { query: "x", limit: 101 }), invalid());
  assert.throws(() => buildTrajectorySearch(entries, "missing-leaf", { query: "x" }), invalid());
});

test("parses type prefixes from the typed query", () => {
  assert.deepEqual(parseTrajectorySearchQuery("  parser  "), { type: "all", term: "parser" });
  assert.deepEqual(parseTrajectorySearchQuery("user: parser"), { type: "user", term: "parser" });
  assert.deepEqual(parseTrajectorySearchQuery("U:parser"), { type: "user", term: "parser" });
  assert.deepEqual(parseTrajectorySearchQuery("assistant: parser"), { type: "assistant", term: "parser" });
  assert.deepEqual(parseTrajectorySearchQuery("a: parser"), { type: "assistant", term: "parser" });
  assert.deepEqual(parseTrajectorySearchQuery("thinking: parser"), { type: "thinking", term: "parser" });
  assert.deepEqual(parseTrajectorySearchQuery("th: parser"), { type: "thinking", term: "parser" });
  assert.deepEqual(parseTrajectorySearchQuery("tool: parser"), { type: "tool", term: "parser" });
  assert.deepEqual(parseTrajectorySearchQuery("t: parser"), { type: "tool", term: "parser" });
  assert.deepEqual(parseTrajectorySearchQuery("timeout: parser"), { type: "all", term: "timeout: parser" });
  assert.deepEqual(parseTrajectorySearchQuery("user:"), { type: "user", term: "" });
});

test("rewrites the typed query when the type selector changes", () => {
  assert.equal(withTrajectorySearchType("user: parser", "tool"), "tool: parser");
  assert.equal(withTrajectorySearchType("parser", "thinking"), "thinking: parser");
  assert.equal(withTrajectorySearchType("tool: parser", "all"), "parser");
  assert.equal(withTrajectorySearchType("user:", "all"), "");
});
