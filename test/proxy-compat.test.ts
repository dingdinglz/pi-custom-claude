import assert from "node:assert/strict";
import { test } from "node:test";
import { hasApi, normalizeContext, Type, type Model, type TranscriptContext } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { DEFAULT_BASE_URL } from "../src/base-url.ts";
import { createCustomAnthropicProvider } from "../src/provider.ts";

function nativeProvider() {
  return builtinProviders().find((provider) => provider.id === "anthropic")!;
}

function managedModel(baseUrl: string): Model<"anthropic-messages"> {
  const model = nativeProvider().getModels().find((model) =>
    hasApi(model, "anthropic-messages") && model.compat?.supportsMidConvoEffort,
  );
  assert.ok(model && hasApi(model, "anthropic-messages"));
  return { ...model, baseUrl };
}

function transcript(model: Model<"anthropic-messages">): TranscriptContext {
  const tool = (name: string, description: string) => ({ name, description, parameters: Type.Object({}) });
  return normalizeContext({ messages: [
    {
      role: "system", content: "Initial instructions", timestamp: 0,
      sections: { policy: "Old policy", obsolete: "Obsolete rule" },
      toolsAdded: [tool("lookup", "Old lookup"), tool("removed", "Remove this tool")],
    },
    { role: "user", content: "Find something", timestamp: 1 },
    {
      role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: [{ type: "toolCall", id: "call_1", name: "lookup", arguments: {} }],
      providerThinkingLevel: "low", timestamp: 2, stopReason: "toolUse",
      usage: {
        input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    },
    {
      role: "toolResult", toolCallId: "call_1", toolName: "lookup",
      content: [{ type: "text", text: "Found it" }], isError: false, timestamp: 3,
    },
    {
      role: "system", content: "Follow-up instructions", timestamp: 4,
      sections: { policy: "Updated policy", obsolete: null },
      toolsRemoved: [{ name: "removed" }, { name: "lookup" }],
      toolsAdded: [tool("lookup", "Updated lookup"), tool("added", "New tool")],
    },
    { role: "user", content: "Continue", timestamp: 5 },
  ] });
}

interface Payload {
  messages: { role: string; content: unknown[] | string; output_config?: { effort: string } }[];
  system?: { type: string; text: string }[];
  tools?: { name: string; description?: string }[];
  output_config?: { effort: string };
  thinking?: { type: string; block_binding?: unknown };
}

// Simulate the reported Bedrock validation without sending keys or prompts to a real service.
function wireMock(acceptNativeSystemMessages = false) {
  const requests: { payload: Payload; headers: Headers }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const payload = await request.json() as Payload;
    requests.push({ payload, headers: request.headers });
    if (!acceptNativeSystemMessages) {
      const emptySystem = payload.messages.findIndex((message) =>
        message.role === "system" && Array.isArray(message.content) && message.content.length === 0,
      );
      const error = emptySystem >= 0
        ? `messages.${emptySystem}: system content must contain at least one block`
        : payload.messages.some((message) => message.role === "system")
          ? "This endpoint only accepts user/assistant conversation messages"
          : undefined;
      if (error) return Response.json({ error: { type: "aws_invoke_error", message: error } }, { status: 400 });
    }
    const events = [
      { type: "message_start", message: {
        id: "msg_compat", type: "message", role: "assistant", content: [], model: "mock-model",
        stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 0 },
      } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "OK" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
      { type: "message_stop" },
    ];
    return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
      headers: { "content-type": "text/event-stream" },
    });
  };
  return { requests, fetch };
}

test("reproduces the Bedrock empty-system error with Pi's native managed-effort model", async () => {
  const model = managedModel("https://proxy.invalid");
  const wire = wireMock();
  const result = await nativeProvider().streamSimple(model, transcript(model), {
    apiKey: "test-key", reasoning: "medium", fetch: wire.fetch, maxRetries: 0,
  }).result();
  assert.equal(result.stopReason, "error");
  assert.match(result.errorMessage!, /system content must contain at least one block/);
  assert.equal(wire.requests.length, 1);
});

for (const method of ["stream", "streamSimple"] as const) {
  test(`${method}: custom endpoints preserve instructions, tools and effort without mid-conversation control messages`, async () => {
    const provider = createCustomAnthropicProvider();
    const model = managedModel("https://proxy.invalid/anthropic");
    const context = transcript(model);
    const before = structuredClone({ model, context });
    const wire = wireMock();
    let payloadCalls = 0;
    let responseCalls = 0;
    let eventCalls = 0;
    const options = {
      apiKey: "test-key", fetch: wire.fetch, maxRetries: 0,
      onPayload(payload: unknown) { payloadCalls++; return payload; },
      onResponse() { responseCalls++; },
      onProviderStreamEvent() { eventCalls++; },
    };
    const stream = method === "stream"
      ? provider.stream(model, context, { ...options, thinkingEnabled: true, effort: "medium" })
      : provider.streamSimple(model, context, { ...options, reasoning: "medium" });
    const result = await stream.result();
    assert.equal(result.stopReason, "stop", result.errorMessage);
    assert.deepEqual(result.content, [{ type: "text", text: "OK" }]);
    assert.equal(payloadCalls, 1);
    assert.equal(responseCalls, 1);
    assert.ok(eventCalls > 0);
    assert.equal(wire.requests.length, 1);
    const { payload, headers } = wire.requests[0];
    assert.ok(payload.messages.every((message) => message.role !== "system"));
    const system = payload.system!.map((block) => block.text).join("\n");
    assert.match(system, /Initial instructions/);
    assert.match(system, /Follow-up instructions/);
    assert.match(system, /Updated policy/);
    assert.doesNotMatch(system, /Old policy|Obsolete rule/);
    assert.deepEqual(payload.tools?.map((tool) => [tool.name, tool.description]), [
      ["lookup", "Updated lookup"], ["added", "New tool"],
    ]);
    assert.deepEqual(payload.messages.map((message) => message.role), ["user", "assistant", "user", "user"]);
    assert.ok(JSON.stringify(payload.messages[2].content).includes('"tool_use_id":"call_1"'));
    assert.equal(payload.output_config?.effort, "medium");
    assert.equal(payload.thinking?.type, "adaptive");
    assert.equal(payload.thinking?.block_binding, undefined);
    assert.doesNotMatch(headers.get("anthropic-beta") ?? "", /mid-conversation|thinking-binding|inline-tools/);
    assert.deepEqual({ model, context }, before, "Must not mutate model metadata or the session transcript");
  });
}

for (const baseUrl of [DEFAULT_BASE_URL, `${DEFAULT_BASE_URL}/`]) {
  test(`official endpoint keeps native transport features: ${baseUrl}`, async () => {
    const provider = createCustomAnthropicProvider();
    const model = managedModel(baseUrl);
    const wire = wireMock(true);
    const result = await provider.streamSimple(model, transcript(model), {
      apiKey: "test-key", reasoning: "medium", fetch: wire.fetch, maxRetries: 0,
    }).result();
    assert.equal(result.stopReason, "stop", result.errorMessage);
    const { payload } = wire.requests[0];
    assert.ok(payload.messages.some((message) => message.role === "system" &&
      Array.isArray(message.content) && message.content.length === 0));
    assert.ok(payload.thinking?.block_binding);
  });
}
