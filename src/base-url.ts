export const DEFAULT_BASE_URL = "https://api.anthropic.com";

/** Pi's Anthropic client appends /v1/messages to this URL. */
export function normalizeBaseUrl(input: string): string {
  const value = input.trim() || DEFAULT_BASE_URL;
  if (!/^https?:\/\//i.test(value) || /\s/.test(value)) {
    throw new Error("Base URL 必须是完整的 http:// 或 https:// 地址，且不能包含空白字符。");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Base URL 格式无效。");
  }

  if (url.username || url.password || value.includes("?") || value.includes("#")) {
    throw new Error("Base URL 不能包含用户名、密码、查询参数或 URL 片段。");
  }

  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/v1/messages/count_tokens")) {
    throw new Error("Base URL 不能使用 /v1/messages/count_tokens 计数接口；请填写服务根地址或 /v1 地址。");
  }

  // URL paths are case-sensitive: normalize only the documented lowercase forms.
  url.pathname = path.replace(/\/v1(?:\/messages)?$/, "");
  return url.toString().replace(/\/+$/, "");
}

/** Recognize loopback URLs without DNS lookups; other HTTP destinations warrant a warning. */
export function isRemoteHttpUrl(baseUrl: string): boolean {
  const url = new URL(baseUrl);
  const hostname = url.hostname.replace(/\.$/, "");
  const isLoopback = hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  return url.protocol === "http:" && !isLoopback;
}
