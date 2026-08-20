import { describe, expect, it } from "vitest";

import { isContainedPath } from "./snapshot-artifacts.mjs";

describe("snapshot artifact consumer isolation", () => {
  it("rejects a sibling path whose text merely shares the consumer prefix", () => {
    expect(isContainedPath("/tmp/consumer", "/tmp/consumer-outside/node_modules/pkg")).toBe(false);
  });

  it("accepts the consumer root and actual descendants", () => {
    expect(isContainedPath("/tmp/consumer", "/tmp/consumer")).toBe(true);
    expect(isContainedPath("/tmp/consumer", "/tmp/consumer/node_modules/pkg")).toBe(true);
  });
});
