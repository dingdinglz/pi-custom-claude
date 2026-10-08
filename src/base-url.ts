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

  // Accept the root URL and common copy/pasted Anthropic endpoint forms.
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1(?:\/messages)?$/, "");
  return url.toString().replace(/\/+$/, "");
}
