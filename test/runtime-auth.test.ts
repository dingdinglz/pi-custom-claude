import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  hasApi, InMemoryCredentialStore, InMemoryModelsStore,
  type Api, type ApiKeyCredential, type Model, type ModelsSimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { BASE_URL_ENV, createCustomAnthropicProvider } from "../src/provider.ts";
import { COMPAT_ENV } from "../src/proxy-compat.ts";

const CONFIGURED_URL = "https://configured.example.com/anthropic";

async function setup(t: TestContext, env: Record<string, string>, credential?: ApiKeyCredential) {
  const directory = await mkdtemp(join(tmpdir(), "pi-custom-claude-auth-"));
  const originalEnv = process.env;
  // This test file runs in its own process. Never read the user's credentials or cloud environment.
  process.env = {
    PATH: originalEnv.PATH, HOME: directory,
    ANTHROPIC_API_KEY: "test-anthropic-key", OPENAI_API_KEY: "test-openai-key", ...env,
  };
  t.after(async () => {
    process.env = originalEnv;
    await rm(directory, { recursive: true, force: true });
  });
  const modelsPath = join(directory, "models.json");
  await writeFile(modelsPath, JSON.stringify({ providers: { anthropic: { baseUrl: CONFIGURED_URL } } }));
  const credentials = new InMemoryCredentialStore();
  if (credential) await credentials.modify("anthropic", async () => credential);
  const runtime = await ModelRuntime.create({
    credentials, modelsPath, modelsStore: new InMemoryModelsStore(),
    refreshOnCreate: false, allowModelNetwork: false,
  });
  runtime.registerNativeProvider(createCustomAnthropicProvider());
  // Registration queues a refresh; finish an explicit pass before inspecting snapshots.
  await runtime.refresh({ allowNetwork: false });
  const model = runtime.getModels("anthropic").find((model) =>
    hasApi(model, "anthropic-messages") && model.compat?.supportsMidConvoEffort,
  );
  assert.ok(model && hasApi(model, "anthropic-messages"));
  return { runtime, model, credentials };
}

async function inspectRequest(runtime: ModelRuntime, model: Model<Api>, options?: ModelsSimpleStreamOptions) {
  let requestModel: Model<Api> | undefined;
  let fetchCalled = false;
  const result = await runtime.completeSimple(model, {
    messages: [{ role: "user", content: "hello", timestamp: 0 }],
  }, {
    maxTokens: 32, reasoning: "medium", ...options,
    onPayload(_payload, resolvedModel) {
      requestModel = resolvedModel;
      throw new Error("test: inspected payload before network");
    },
    fetch: async () => {
      fetchCalled = true;
      throw new Error("Unexpected network request");
    },
  });
  assert.equal(result.stopReason, "error");
  assert.match(result.errorMessage!, /test: inspected payload before network/);
  assert.equal(fetchCalled, false);
  assert.ok(requestModel);
  return requestModel;
}

test("ModelRuntime lists all providers despite an invalid Anthropic endpoint, but requests still reject it", async (t) => {
  const { runtime } = await setup(t, { [BASE_URL_ENV]: "gateway.example.com" });
  const available = await runtime.getAvailable();
  assert.ok(available.some((model) => model.provider === "openai"));
  assert.ok(available.some((model) => model.provider === "anthropic"));
  assert.equal((await runtime.checkAuth("anthropic"))?.type, "api_key");
  assert.equal(runtime.getError(), undefined);
  await assert.rejects(() => runtime.getAuth("anthropic"), /Base URL/);
});

for (const value of ["", " \t "]) {
  test(`ModelRuntime preserves models.json endpoint for empty ambient URL ${JSON.stringify(value)}`, async (t) => {
    const { runtime, model } = await setup(t, { [BASE_URL_ENV]: value });
    assert.equal(model.baseUrl, CONFIGURED_URL);
    assert.equal((await inspectRequest(runtime, model)).baseUrl, CONFIGURED_URL);
  });
}

for (const source of ["runtime", "request"] as const) {
  test(`${source} API key override works with ambient Base URL without changing saved credentials`, async (t) => {
    const saved: ApiKeyCredential = {
      type: "api_key", key: "saved-key", env: { [BASE_URL_ENV]: "https://saved.example.com" },
    };
    const { runtime, model, credentials } = await setup(t, { [BASE_URL_ENV]: "https://ambient.example.com/v1" }, saved);
    if (source === "runtime") await runtime.setRuntimeApiKey("anthropic", "override-key");
    const options = source === "request" ? { apiKey: "override-key" } : undefined;
    assert.equal((await runtime.getAuth("anthropic", options))?.auth.apiKey, "override-key");
    assert.equal((await inspectRequest(runtime, model, options)).baseUrl, "https://ambient.example.com");
    assert.deepEqual(await credentials.read("anthropic"), saved);
  });
}

for (const source of ["credential", "environment"] as const) {
  test(`ModelRuntime forwards ${source} compatibility opt-out to models.json endpoints`, async (t) => {
    const { runtime, model } = await setup(t,
      { [COMPAT_ENV]: source === "credential" ? "on" : "off" },
      source === "credential" ? { type: "api_key", key: "test-key", env: { [COMPAT_ENV]: "off" } } : undefined,
    );
    const requestModel = await inspectRequest(runtime, model);
    assert.ok(hasApi(requestModel, "anthropic-messages"));
    assert.equal(requestModel.compat?.supportsMidConvoEffort, true);
    assert.equal(requestModel.baseUrl, CONFIGURED_URL);

    const overridden = await inspectRequest(runtime, model, { env: { [COMPAT_ENV]: "on" } });
    assert.ok(hasApi(overridden, "anthropic-messages"));
    assert.equal(overridden.compat?.supportsMidConvoEffort, false);
  });
}
