import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(join(tmpdir(), "pi-web-llama-auth-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const server = createServer((req, res) => {
  if (req.url === "/models") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "loaded-model", status: { value: "loaded" } }] }));
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const serverUrl = `http://127.0.0.1:${server.address().port}`;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");

after(async () => {
  server.close();
  await rm(agentDir, { recursive: true, force: true });
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

test("rejects cross-site API-key requests before contacting the llama server", async () => {
  const response = await POST(
    new Request("http://localhost/api/auth/api-key/llama.cpp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "localhost",
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "cross-site",
      },
      body: JSON.stringify({ serverUrl }),
    }),
    { params: Promise.resolve({ provider: "llama.cpp" }) },
  );

  assert.equal(response.status, 403);
});

test("validates llama server URLs at the API boundary", async () => {
  const response = await POST(
    new Request("http://localhost/api/auth/api-key/llama.cpp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "localhost" },
      body: JSON.stringify({ serverUrl: "ftp://internal.example" }),
    }),
    { params: Promise.resolve({ provider: "llama.cpp" }) },
  );

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /http\(s\) URL/);
});

test("configures llama.cpp with a server URL and optional API key", async () => {
  const response = await POST(
    new Request("http://localhost/api/auth/api-key/llama.cpp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "localhost" },
      body: JSON.stringify({ serverUrl }),
    }),
    { params: Promise.resolve({ provider: "llama.cpp" }) },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });

  let auth = JSON.parse(await readFile(join(agentDir, "auth.json"), "utf8"));
  assert.equal(auth["llama.cpp"].env.LLAMA_BASE_URL, serverUrl);
  assert.equal(auth["llama.cpp"].key, undefined);

  const keyedResponse = await POST(
    new Request("http://localhost/api/auth/api-key/llama.cpp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "localhost" },
      body: JSON.stringify({ serverUrl, apiKey: "stored-secret" }),
    }),
    { params: Promise.resolve({ provider: "llama.cpp" }) },
  );
  assert.equal(keyedResponse.status, 200);

  const preservedResponse = await POST(
    new Request("http://localhost/api/auth/api-key/llama.cpp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "localhost" },
      body: JSON.stringify({ serverUrl }),
    }),
    { params: Promise.resolve({ provider: "llama.cpp" }) },
  );
  assert.equal(preservedResponse.status, 200);
  auth = JSON.parse(await readFile(join(agentDir, "auth.json"), "utf8"));
  assert.equal(auth["llama.cpp"].key, "stored-secret");

  const clearedResponse = await POST(
    new Request("http://localhost/api/auth/api-key/llama.cpp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "localhost" },
      body: JSON.stringify({ serverUrl, apiKey: "" }),
    }),
    { params: Promise.resolve({ provider: "llama.cpp" }) },
  );
  assert.equal(clearedResponse.status, 200);
  auth = JSON.parse(await readFile(join(agentDir, "auth.json"), "utf8"));
  assert.equal(auth["llama.cpp"].key, undefined);
});
