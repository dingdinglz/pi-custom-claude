import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { hasApi } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { BASE_URL_ENV, createCustomAnthropicProvider } from "../src/provider.ts";
import { COMPAT_ENV } from "../src/proxy-compat.ts";

test("real Pi runtime routes requests immediately, after re-login and after restart", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-custom-claude-runtime-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests: { url: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ url: request.url!, headers: request.headers, body: JSON.parse(body) });
    const events = [
      { type: "message_start", message: {
        id: "msg_test", type: "message", role: "assistant", content: [], model: "test-model",
        stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 0 },
      } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "你好" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } },
      { type: "message_stop" },
    ];
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const authPath = join(directory, "auth.json");

  async function createRuntime() {
    const runtime = await ModelRuntime.create({
      authPath,
      modelsPath: null,
      modelsStorePath: join(directory, "models-cache.json"),
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    runtime.registerNativeProvider(createCustomAnthropicProvider());
    return runtime;
  }

  let runtime = await createRuntime();
  // Keep the same selected model object across login and endpoint changes.
  const selected = runtime.getModels("anthropic").find((model) =>
    hasApi(model, "anthropic-messages") && model.compat?.supportsMidConvoEffort,
  );
  assert.ok(selected);
  const model = selected;
  const originalModelUrl = model.baseUrl;
  const originalModelCompat = structuredClone(model.compat);
  async function login(prefix: string, key: string) {
    const answers = [key, `${origin}/${prefix}/v1/messages`];
    await runtime.login("anthropic", "api_key", {
      prompt: async () => answers.shift()!,
      notify() {},
    });
  }
  async function request() {
    let payloadObserved = false;
    const result = await runtime.completeSimple(model, {
      messages: [{ role: "user", content: "hello", timestamp: 0 }],
    }, {
      maxTokens: 32,
      reasoning: "medium",
      env: { [COMPAT_ENV]: "on" },
      signal: AbortSignal.timeout(5000),
      onPayload() { payloadObserved = true; },
    });
    assert.equal(result.stopReason, "stop", result.errorMessage);
    assert.deepEqual(result.content, [{ type: "text", text: "你好" }]);
    assert.equal(result.usage.input, 3);
    assert.equal(result.usage.output, 2);
    assert.equal(payloadObserved, true);
    assert.equal(model.baseUrl, originalModelUrl, "Must not mutate the shared model catalog");
    assert.deepEqual(model.compat, originalModelCompat);
  }

  await login("first", "first-test-key");
  await request();
  const saved = JSON.parse(await readFile(authPath, "utf8"));
  assert.equal(saved.anthropic.type, "api_key");
  assert.equal(saved.anthropic.key, "first-test-key");
  assert.equal(saved.anthropic.env[BASE_URL_ENV], `${origin}/first`);

  await login("second", "second-test-key");
  await request();

  runtime = await createRuntime();
  await request();
  assert.deepEqual(requests.map((entry) => new URL(entry.url, origin).pathname), [
    "/first/v1/messages", "/second/v1/messages", "/second/v1/messages",
  ]);
  assert.deepEqual(requests.map((entry) => entry.headers["x-api-key"]), [
    "first-test-key", "second-test-key", "second-test-key",
  ]);
  assert.ok(requests.every((entry) => entry.body.model === model.id && entry.body.stream === true));
  for (const { body } of requests) {
    assert.ok(Array.isArray(body.messages));
    assert.ok(body.messages.every((message) => message.role !== "system"));
    assert.deepEqual(body.output_config, { effort: "medium" });
  }

  await runtime.logout("anthropic");
  assert.equal(JSON.parse(await readFile(authPath, "utf8")).anthropic, undefined);
});
