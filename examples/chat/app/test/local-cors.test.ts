import { describe, expect, it } from "vitest";

import { LocalChatCors } from "../src/local-cors.js";

describe("local Chat gateway CORS", () => {
  it("admits the configured web origin and Connect request headers only", () => {
    expect(LocalChatCors.headers("http://127.0.0.1:5173", "OPTIONS")).toEqual({
      "access-control-allow-headers": "authorization,content-type,connect-protocol-version",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-origin": "http://127.0.0.1:5173",
      "access-control-max-age": "600",
    });
  });

  it("does not grant a different origin", () => {
    expect(LocalChatCors.headers("http://localhost:5173", "OPTIONS")).toEqual({});
  });

  it("allows a non-preflight Connect request from the configured origin", () => {
    expect(LocalChatCors.headers("http://127.0.0.1:5173", "POST")).toEqual({
      "access-control-allow-origin": "http://127.0.0.1:5173",
    });
  });
});
