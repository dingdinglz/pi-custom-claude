import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createCustomAnthropicProvider } from "./src/provider.ts";

export default function (pi: ExtensionAPI) {
  pi.registerProvider(createCustomAnthropicProvider());
}
