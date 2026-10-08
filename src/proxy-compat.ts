import type { Api, Model, ProviderEnv } from "@earendil-works/pi-ai";
import { DEFAULT_BASE_URL } from "./base-url.ts";

export const COMPAT_ENV = "PI_CUSTOM_CLAUDE_COMPAT";

/** Apply compatibility to the resolved request endpoint, never to the shared catalog. */
export function withProxyCompatibility<TApi extends Api>(model: Model<TApi>, env?: ProviderEnv): Model<TApi>;
export function withProxyCompatibility(model: Model<Api>, env?: ProviderEnv): Model<Api> {
  if (model.api !== "anthropic-messages") return model;

  const mode = (env?.[COMPAT_ENV]?.trim() || process.env[COMPAT_ENV]?.trim() || "on").toLowerCase();
  if (mode !== "on" && mode !== "off") {
    throw new Error(`${COMPAT_ENV} 仅支持 on 或 off（留空默认为 on）。`);
  }
  if (mode === "off" || model.baseUrl.replace(/\/+$/, "") === DEFAULT_BASE_URL) return model;

  return {
    ...model,
    compat: {
      ...model.compat,
      // Native managed effort injects system messages with content: [], rejected
      // by Bedrock-backed gateways. Use request-level thinking/effort instead.
      supportsMidConvoEffort: false,
      // Let Pi replay system/tool deltas into the top-level prompt and tool list.
      // Dropping raw system messages here would lose instructions/tool updates.
      supportsMidConvoSystemMessages: false,
      supportsMidConvoToolChanges: false,
    },
  };
}
