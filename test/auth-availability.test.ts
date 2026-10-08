import assert from "node:assert/strict";
import { test } from "node:test";
import { createModels, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { BASE_URL_ENV, createCustomAnthropicProvider } from "../src/provider.ts";
import { COMPAT_ENV } from "../src/proxy-compat.ts";

function fixture(env: Record<string, string>) {
  const credentials = new InMemoryCredentialStore();
  const models = createModels({
    credentials,
    authContext: { env: async (name) => env[name], fileExists: async () => false },
  });
  models.setProvider(createCustomAnthropicProvider());
  models.setProvider(builtinProviders().find((provider) => provider.id === "openai")!);
  return { credentials, models };
}

for (const source of ["environment", "credential"] as const) {
  test(`invalid URL in ${source} does not break checkAuth or all-provider availability`, async () => {
    const { credentials, models } = fixture({
      ANTHROPIC_API_KEY: "test-anthropic-key",
      OPENAI_API_KEY: "test-openai-key",
      [BASE_URL_ENV]: source === "environment" ? "gateway.example.com" : "https://valid.example.com",
    });
    if (source === "credential") {
      await credentials.modify("anthropic", async () => ({
        type: "api_key", key: "test-stored-key", env: { [BASE_URL_ENV]: "gateway.example.com" },
      }));
    }
    assert.equal((await models.checkAuth("anthropic"))?.type, "api_key");
    assert.equal((await models.checkAuth("openai"))?.type, "api_key");
    const available = await models.getAvailable();
    assert.ok(available.some((model) => model.provider === "openai"));
    assert.ok(available.some((model) => model.provider === "anthropic"));
    assert.ok((await models.getAllAvailable()).some((model) => model.provider === "openai"));
    await assert.rejects(() => models.getAuth("anthropic"), /Base URL/);
  });
}

test("availability check only resolves credentials, not endpoint or compatibility settings", async () => {
  const names: string[] = [];
  const result = await createCustomAnthropicProvider().auth.apiKey!.check!({
    ctx: {
      env: async (name) => {
        names.push(name);
        assert.ok(name !== BASE_URL_ENV && name !== COMPAT_ENV);
        return name === "ANTHROPIC_API_KEY" ? "test-key" : undefined;
      },
      fileExists: async () => false,
    },
    signal: new AbortController().signal,
  });
  assert.deepEqual(result, { type: "api_key", source: "ANTHROPIC_API_KEY" });
  assert.ok(names.includes("ANTHROPIC_API_KEY"));
});

test("availability check still honors cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createCustomAnthropicProvider().auth.apiKey!.check!({
    credential: { type: "api_key", key: "test-key" },
    ctx: { env: async () => undefined, fileExists: async () => false },
    signal: controller.signal,
  }), { name: "AbortError" });
});

test("invalid settings do not authenticate a provider without credentials", async () => {
  const { models } = fixture({
    OPENAI_API_KEY: "test-openai-key", [BASE_URL_ENV]: "invalid", [COMPAT_ENV]: "invalid",
  });
  assert.equal(await models.checkAuth("anthropic"), undefined);
  const available = await models.getAvailable();
  assert.ok(available.length > 0);
  assert.ok(available.every((model) => model.provider === "openai"));
});

test("request API key override uses ambient Base URL and compat, not the saved credential", async () => {
  const { credentials, models } = fixture({
    [BASE_URL_ENV]: "https://ambient.example.com/v1", [COMPAT_ENV]: "off",
  });
  const original = {
    type: "api_key" as const, key: "stored-key",
    env: { [BASE_URL_ENV]: "https://saved.example.com", [COMPAT_ENV]: "on" },
  };
  await credentials.modify("anthropic", async () => original);
  const result = await models.getAuth("anthropic", { apiKey: "override-key" });
  assert.deepEqual(result?.auth, { apiKey: "override-key", baseUrl: "https://ambient.example.com" });
  assert.equal(result?.env?.[COMPAT_ENV], "off");
  assert.deepEqual(await credentials.read("anthropic"), original);
});

test("request-scoped URL and compatibility override ambient values", async () => {
  const { models } = fixture({ [BASE_URL_ENV]: "https://ambient.example.com", [COMPAT_ENV]: "off" });
  const result = await models.getAuth("anthropic", {
    apiKey: "override-key", env: { [BASE_URL_ENV]: "https://request.example.com/v1", [COMPAT_ENV]: "on" },
  });
  assert.deepEqual(result?.auth, { apiKey: "override-key", baseUrl: "https://request.example.com" });
  assert.equal(result?.env?.[COMPAT_ENV], "on");
});

test("empty ambient Base URL with an API key override leaves the model URL unchanged", async () => {
  const { models } = fixture({ [BASE_URL_ENV]: " \t " });
  const result = await models.getAuth("anthropic", { apiKey: "override-key" });
  assert.deepEqual(result?.auth, { apiKey: "override-key" });
});
