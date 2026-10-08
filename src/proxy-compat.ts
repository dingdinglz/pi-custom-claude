import type { Api, Model } from "@earendil-works/pi-ai";
import { DEFAULT_BASE_URL } from "./base-url.ts";

/** Apply compatibility to the resolved request endpoint, never to the shared catalog. */
export function withProxyCompatibility<TApi extends Api>(model: Model<TApi>): Model<TApi>;
export function withProxyCompatibility(model: Model<Api>): Model<Api> {
  if (model.api !== "anthropic-messages" || model.baseUrl.replace(/\/+$/, "") === DEFAULT_BASE_URL) {
    return model;
  }

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
