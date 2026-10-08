import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BASE_URL, isRemoteHttpUrl, normalizeBaseUrl } from "../src/base-url.ts";

for (const [input, expected] of [
  ["", DEFAULT_BASE_URL],
  ["  ", DEFAULT_BASE_URL],
  ["https://api.anthropic.com/", DEFAULT_BASE_URL],
  [" https://gateway.example.com/// ", "https://gateway.example.com"],
  ["https://gateway.example.com/v1", "https://gateway.example.com"],
  ["https://gateway.example.com/v1/messages/", "https://gateway.example.com"],
  ["https://gateway.example.com/anthropic/v1/", "https://gateway.example.com/anthropic"],
  ["https://gateway.example.com/proxy", "https://gateway.example.com/proxy"],
  ["https://gateway.example.com/V1", "https://gateway.example.com/V1"],
  ["https://gateway.example.com/Proxy/V1/messages", "https://gateway.example.com/Proxy/V1/messages"],
  ["https://gateway.example.com/Proxy/v1/messages", "https://gateway.example.com/Proxy"],
  ["http://localhost:8080/v1", "http://localhost:8080"],
  ["http://[::1]:8080/anthropic/", "http://[::1]:8080/anthropic"],
]) {
  test(`normalizes ${JSON.stringify(input)}`, () => {
    assert.equal(normalizeBaseUrl(input), expected);
  });
}

for (const input of [
  "gateway.example.com",
  "https:gateway.example.com",
  "ftp://gateway.example.com",
  "file:///tmp/socket",
  "https://",
  "https://bad host.example.com",
  "https://gateway.example.com/line\nbreak",
  "https://user:password@gateway.example.com",
  "https://gateway.example.com?key=secret",
  "https://gateway.example.com?",
  "https://gateway.example.com#fragment",
  "https://gateway.example.com/v1/messages/count_tokens",
  "https://gateway.example.com/proxy/v1/messages/count_tokens/",
]) {
  test(`rejects invalid URL ${JSON.stringify(input)}`, () => {
    assert.throws(() => normalizeBaseUrl(input), /Base URL/);
  });
}

test("validation errors do not echo credentials", () => {
  assert.throws(() => normalizeBaseUrl("https://user:secret@gateway.example.com"), (error: Error) => {
    assert.ok(!error.message.includes("secret"));
    return true;
  });
});

for (const [url, expected] of [
  ["http://gateway.example.com", true],
  ["http://192.168.1.2:8080", true],
  ["http://localhost.example.com", true],
  ["http://0.0.0.0:8080", true],
  ["https://gateway.example.com", false],
  ["http://localhost:8080", false],
  ["http://LOCALHOST.:8080", false],
  ["http://proxy.localhost:8080", false],
  ["http://127.0.0.1:8080", false],
  ["http://127.10.20.30:8080", false],
  ["http://[::1]:8080", false],
] as const) {
  test(`HTTP warning decision for ${url}`, () => {
    assert.equal(isRemoteHttpUrl(url), expected);
  });
}
