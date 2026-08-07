import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const copiedSource = "packages/proto/proto/spine/server/entity/state_key.proto";
const frozenSourceSha256 = "a93a91761171f87da5b3f9c269e4a23a41075d9cfc169922e52fadcacf6f3ffb";

describe("EntityStateKey frozen contract", () => {
  it("matches the pinned JVM EntityStateKey Proto bytes", () => {
    const source = readFileSync(copiedSource);
    expect(createHash("sha256").update(source).digest("hex")).toBe(frozenSourceSha256);
  });
});
