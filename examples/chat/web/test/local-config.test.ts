import { describe, expect, it } from "vitest";

import { LocalChatGateway } from "../src/local-config.js";

describe("LocalChatGateway", () => {
  it("accepts the default and an explicit loopback HTTP port", () => {
    expect(LocalChatGateway.url({})).toBe("http://127.0.0.1:8090");
    expect(LocalChatGateway.url({ VITE_CHAT_GATEWAY_URL: "http://127.0.0.1:3210" })).toBe(
      "http://127.0.0.1:3210",
    );
  });

  it.each(["https://127.0.0.1:8090", "http://localhost:8090", "http://127.0.0.1:0"])(
    "rejects %s",
    (value) => {
      expect(() => LocalChatGateway.url({ VITE_CHAT_GATEWAY_URL: value })).toThrow();
    },
  );
});
