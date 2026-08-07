import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const copiedSource = "packages/proto/proto/spine/server/entity/entity.proto";
const frozenSourceSha256 = "dee803dfca358b1e0c9a59ffa9385f6535a455ba466e35f0420b0b00175708b7";

describe("EntityRecord frozen contract", () => {
  it("matches the pinned JVM EntityRecord Proto bytes", () => {
    const source = readFileSync(copiedSource);
    expect(createHash("sha256").update(source).digest("hex")).toBe(frozenSourceSha256);
  });
});
