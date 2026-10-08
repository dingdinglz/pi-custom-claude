import type { Provider, ProviderAuthInteraction } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { DEFAULT_BASE_URL, normalizeBaseUrl } from "./base-url.ts";
import { withProxyCompatibility } from "./proxy-compat.ts";

export const BASE_URL_ENV = "ANTHROPIC_BASE_URL";

async function promptBaseUrl(interaction: ProviderAuthInteraction): Promise<string> {
  interaction.notify({
    type: "info",
    message: "请只填写你信任的 Anthropic 兼容服务；API Key 和对话内容会发送到该地址。",
  });

  while (true) {
    interaction.signal.throwIfAborted();
    const input = await interaction.prompt({
      type: "text",
      message: `Anthropic Base URL（留空使用 ${DEFAULT_BASE_URL}）`,
      placeholder: DEFAULT_BASE_URL,
      signal: interaction.signal,
    });
    interaction.signal.throwIfAborted();

    try {
      return normalizeBaseUrl(input);
    } catch (error) {
      interaction.notify({ type: "info", message: (error as Error).message });
    }
  }
}

export function createCustomAnthropicProvider(): Provider {
  // Pi 1.1.0's extension loader aliases providers/all, not individual factories.
  const provider = builtinProviders().find((candidate) => candidate.id === "anthropic");
  const nativeAuth = provider?.auth.apiKey;
  const nativeLogin = nativeAuth?.login;
  if (!provider || !nativeAuth || !nativeLogin) {
    throw new Error("当前 Pi 版本没有 Anthropic API Key 登录接口，请使用 Pi 1.1.0 或兼容版本。");
  }

  return {
    ...provider,
    stream(model, context, options) {
      return provider.stream(withProxyCompatibility(model), context, options);
    },
    streamSimple(model, context, options) {
      return provider.streamSimple(withProxyCompatibility(model), context, options);
    },
    auth: {
      ...provider.auth,
      apiKey: {
        ...nativeAuth,
        name: "Anthropic API key + Base URL",
        async login(interaction) {
          // Keep Pi's secret-input UI and let Pi persist the complete credential.
          const credential = await nativeLogin(interaction);
          const key = credential.key?.trim();
          if (!key) throw new Error("Anthropic API Key 不能为空。");

          const baseUrl = await promptBaseUrl(interaction);
          interaction.signal.throwIfAborted();
          return {
            ...credential,
            key,
            env: { ...credential.env, [BASE_URL_ENV]: baseUrl },
          };
        },
        async resolve(input) {
          const result = await nativeAuth.resolve(input);
          if (!result) return undefined;

          const baseUrl = input.credential?.env?.[BASE_URL_ENV] ?? (await input.ctx.env(BASE_URL_ENV));
          input.signal.throwIfAborted();
          if (baseUrl === undefined) return result;

          // Credential env alone is not enough: Pi applies auth.baseUrl to every
          // request, including requests using an already-selected model.
          return {
            ...result,
            auth: { ...result.auth, baseUrl: normalizeBaseUrl(baseUrl) },
          };
        },
      },
    },
  };
}
