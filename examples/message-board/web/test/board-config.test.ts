import { describe, expect, it } from "vitest";

import { LocalBoardGateway } from "../src/board-config.js";

describe("LocalBoardGateway", () => {
  it("accepts the default and an explicit loopback HTTP port", () => {
    expect(LocalBoardGateway.url({})).toBe("http://127.0.0.1:8090");
    expect(LocalBoardGateway.url({ VITE_MESSAGE_BOARD_GATEWAY_URL: "http://127.0.0.1:3210" })).toBe(
      "http://127.0.0.1:3210",
    );
  });

  it.each(["https://127.0.0.1:8090", "http://localhost:8090", "http://127.0.0.1:0"])(
    "rejects %s",
    (value) => {
      expect(() => LocalBoardGateway.url({ VITE_MESSAGE_BOARD_GATEWAY_URL: value })).toThrow();
    },
  );
});
