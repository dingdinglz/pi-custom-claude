import type { Provider, ProviderAuthInteraction } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { DEFAULT_BASE_URL, isRemoteHttpUrl, normalizeBaseUrl } from "./base-url.ts";
import { COMPAT_ENV, withProxyCompatibility } from "./proxy-compat.ts";

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

    let baseUrl: string;
    try {
      baseUrl = normalizeBaseUrl(input);
    } catch (error) {
      interaction.notify({ type: "info", message: (error as Error).message });
      continue;
    }
    if (isRemoteHttpUrl(baseUrl)) {
      interaction.notify({
        type: "info",
        message: "警告：这是非本机的 HTTP 地址，API Key 和对话内容会明文传输；建议改用 HTTPS。",
      });
    }
    return baseUrl;
  }
}

export function createCustomAnthropicProvider(): Provider {
  // Pi 1.1.0's extension loader aliases providers/all, not individual factories.
  const provider = typeof builtinProviders === "function"
    ? builtinProviders().find((candidate) => candidate.id === "anthropic")
    : undefined;
  const nativeAuth = provider?.auth.apiKey;
  const nativeLogin = nativeAuth?.login;
  if (!provider || typeof nativeLogin !== "function" || typeof nativeAuth?.resolve !== "function" ||
      typeof provider.stream !== "function" || typeof provider.streamSimple !== "function") {
    throw new Error("当前 Pi 版本缺少所需的原生 Anthropic 供应商接口，请使用 Pi 1.1.0 或兼容版本。");
  }

  return {
    ...provider,
    stream(model, context, options) {
      return provider.stream(withProxyCompatibility(model, options?.env), context, options);
    },
    streamSimple(model, context, options) {
      return provider.streamSimple(withProxyCompatibility(model, options?.env), context, options);
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
        async check(input) {
          // A bad endpoint must not break Pi's all-provider availability check.
          // This checks credentials only; resolve() still validates each request.
          input.signal.throwIfAborted();
          if (nativeAuth.check) {
            const result = await nativeAuth.check(input);
            input.signal.throwIfAborted();
            return result;
          }
          const result = await nativeAuth.resolve(input);
          input.signal.throwIfAborted();
          return result ? { type: "api_key", source: result.source } : undefined;
        },
        async resolve(input) {
          const result = await nativeAuth.resolve(input);
          if (!result) return undefined;

          // Empty settings mean unset. Only interactive login turns blank input
          // into an explicit, persisted official URL.
          const baseUrl = input.credential?.env?.[BASE_URL_ENV]?.trim() ||
            (await input.ctx.env(BASE_URL_ENV))?.trim();
          const compatibility = input.credential?.env?.[COMPAT_ENV]?.trim() ||
            (await input.ctx.env(COMPAT_ENV))?.trim();
          input.signal.throwIfAborted();

          // Pi applies auth.baseUrl to the resolved request model. Forward the
          // scoped compatibility setting too, including ambient-only auth flows.
          return {
            ...result,
            ...(baseUrl ? { auth: { ...result.auth, baseUrl: normalizeBaseUrl(baseUrl) } } : {}),
            ...(compatibility ? { env: { ...result.env, [COMPAT_ENV]: compatibility } } : {}),
          };
        },
      },
    },
  };
}
