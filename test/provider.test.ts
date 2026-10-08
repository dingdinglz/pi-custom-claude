import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createModels,
  InMemoryCredentialStore,
  type ApiKeyCredential,
  type AuthContext,
  type AuthEvent,
  type AuthPrompt,
  type ProviderAuthInteraction,
} from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { DEFAULT_BASE_URL } from "../src/base-url.ts";
import { BASE_URL_ENV, createCustomAnthropicProvider } from "../src/provider.ts";

function scriptedInteraction(answers: string[]) {
  const prompts: AuthPrompt[] = [];
  const events: AuthEvent[] = [];
  const controller = new AbortController();
  const interaction: ProviderAuthInteraction = {
    signal: controller.signal,
    async prompt(prompt) {
      prompts.push(prompt);
      const answer = answers.shift();
      assert.notEqual(answer, undefined, "Unexpected extra login prompt");
      return answer!;
    },
    notify(event) {
      events.push(event);
    },
  };
  return { interaction, prompts, events, controller };
}

function authContext(env: Record<string, string> = {}): AuthContext {
  return {
    env: async (name) => env[name],
    fileExists: async () => false,
  };
}

function resolve(credential?: ApiKeyCredential, env: Record<string, string> = {}) {
  return createCustomAnthropicProvider().auth.apiKey!.resolve({
    credential,
    ctx: authContext(env),
    signal: new AbortController().signal,
  });
}

test("keeps the original provider ID, catalog and OAuth method", () => {
  const provider = createCustomAnthropicProvider();
  const original = builtinProviders().find((entry) => entry.id === "anthropic")!;
  assert.equal(provider.id, "anthropic");
  assert.equal(provider.name, original.name);
  assert.deepEqual(provider.getModels(), original.getModels());
  assert.ok(provider.getModels().length > 0);
  assert.equal(provider.auth.oauth?.name, original.auth.oauth?.name);
  assert.equal(provider.auth.oauth?.isSubscription, original.auth.oauth?.isSubscription);
  assert.equal(typeof provider.auth.oauth?.login, "function");
});

test("login uses secret input and returns one credential containing both values", async () => {
  const flow = scriptedInteraction(["  test-api-key  ", " https://gateway.example.com/anthropic/v1/ "]);
  const credential = await createCustomAnthropicProvider().auth.apiKey!.login!(flow.interaction);
  assert.deepEqual(credential, {
    type: "api_key",
    key: "test-api-key",
    env: { [BASE_URL_ENV]: "https://gateway.example.com/anthropic" },
  });
  assert.deepEqual(flow.prompts.map((prompt) => prompt.type), ["secret", "text"]);
  assert.ok(!JSON.stringify(flow.events).includes("test-api-key"));
});

test("blank Base URL explicitly selects the official endpoint", async () => {
  const flow = scriptedInteraction(["test-key", ""]);
  const credential = await createCustomAnthropicProvider().auth.apiKey!.login!(flow.interaction);
  assert.equal(credential.env?.[BASE_URL_ENV], DEFAULT_BASE_URL);
});

test("invalid URL is retried without asking for the API key again", async () => {
  const flow = scriptedInteraction(["test-key", "not-a-url", "https://gateway.example.com"]);
  const credential = await createCustomAnthropicProvider().auth.apiKey!.login!(flow.interaction);
  assert.equal(credential.env?.[BASE_URL_ENV], "https://gateway.example.com");
  assert.deepEqual(flow.prompts.map((prompt) => prompt.type), ["secret", "text", "text"]);
  assert.ok(flow.events.some((event) => event.type === "info" && event.message.includes("Base URL")));
});

test("empty API key fails without prompting for a URL", async () => {
  const flow = scriptedInteraction(["  "]);
  await assert.rejects(createCustomAnthropicProvider().auth.apiKey!.login!(flow.interaction), /不能为空/);
  assert.equal(flow.prompts.length, 1);
});

test("stored URL wins over ambient URL and preserves provider-scoped config", async () => {
  const env = { [BASE_URL_ENV]: "https://saved.example.com/v1", EXTRA: "value" };
  const result = await resolve({ type: "api_key", key: "saved-key", env }, {
    [BASE_URL_ENV]: "https://ambient.example.com",
    ANTHROPIC_API_KEY: "ambient-key",
  });
  assert.deepEqual(result?.auth, { apiKey: "saved-key", baseUrl: "https://saved.example.com" });
  assert.deepEqual(result?.env, env);
});

test("old API-key-only credentials keep native behavior", async () => {
  const result = await resolve({ type: "api_key", key: "existing-key" });
  assert.deepEqual(result?.auth, { apiKey: "existing-key" });
});

test("supports API key and Base URL from environment without persisting them", async () => {
  const result = await resolve(undefined, {
    ANTHROPIC_API_KEY: "environment-key",
    [BASE_URL_ENV]: "http://localhost:8080/proxy/v1",
  });
  assert.deepEqual(result?.auth, { apiKey: "environment-key", baseUrl: "http://localhost:8080/proxy" });
});

test("keeps native bearer-token authentication", async () => {
  const result = await resolve(undefined, {
    ANTHROPIC_AUTH_TOKEN: "bearer-token",
    [BASE_URL_ENV]: "https://gateway.example.com",
  });
  assert.deepEqual(result?.auth, {
    headers: { Authorization: "Bearer bearer-token" },
    baseUrl: "https://gateway.example.com",
  });
});

test("a URL alone does not make the provider authenticated", async () => {
  assert.equal(await resolve(undefined, { [BASE_URL_ENV]: "https://gateway.example.com" }), undefined);
});

test("invalid persisted URL fails closed instead of falling back to another host", async () => {
  await assert.rejects(resolve({ type: "api_key", key: "test-key", env: { [BASE_URL_ENV]: "invalid" } }), /Base URL/);
});

test("Pi login/logout persist and remove the key and endpoint together", async () => {
  const credentials = new InMemoryCredentialStore();
  const models = createModels({ credentials, authContext: authContext() });
  models.setProvider(createCustomAnthropicProvider());
  const flow = scriptedInteraction(["test-key", "https://gateway.example.com"]);
  await models.login("anthropic", "api_key", flow.interaction);
  assert.equal((await models.getAuth("anthropic"))?.auth.baseUrl, "https://gateway.example.com");
  assert.equal((await credentials.read("anthropic"))?.type, "api_key");
  await models.logout("anthropic");
  assert.equal(await credentials.read("anthropic"), undefined);
  assert.equal(await models.getAuth("anthropic"), undefined);
});

for (const phase of ["secret", "text"] as const) {
  test(`cancelling the ${phase} prompt leaves the previous credential intact`, async () => {
    const credentials = new InMemoryCredentialStore();
    const original: ApiKeyCredential = {
      type: "api_key", key: "original-key", env: { [BASE_URL_ENV]: "https://original.example.com" },
    };
    await credentials.modify("anthropic", async () => original);
    const models = createModels({ credentials, authContext: authContext() });
    models.setProvider(createCustomAnthropicProvider());
    await assert.rejects(models.login("anthropic", "api_key", {
      prompt: async (prompt) => {
        if (prompt.type === phase) throw new Error("Login cancelled");
        return "replacement-key";
      },
      notify() {},
    }), /cancelled/);
    assert.deepEqual(await credentials.read("anthropic"), original);
  });
}

test("abort after receiving the URL does not save partial credentials", async () => {
  const credentials = new InMemoryCredentialStore();
  const models = createModels({ credentials, authContext: authContext() });
  models.setProvider(createCustomAnthropicProvider());
  const controller = new AbortController();
  await assert.rejects(models.login("anthropic", "api_key", {
    signal: controller.signal,
    prompt: async (prompt) => {
      if (prompt.type === "text") controller.abort();
      return prompt.type === "secret" ? "test-key" : "https://gateway.example.com";
    },
    notify() {},
  }), { name: "AbortError" });
  assert.equal(await credentials.read("anthropic"), undefined);
});
