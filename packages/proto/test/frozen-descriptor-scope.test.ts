import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFrozenDescriptorSet,
  normalizedDescriptorDigest,
} from "../scripts/verify-descriptor-compatibility.mjs";

describe("frozen descriptor scope", () => {
  it("changes only for manifest-frozen sources", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-frozen-descriptors-"));
    const protoRoot = join(root, "packages/proto/proto/spine");
    mkdirSync(protoRoot, { recursive: true });
    symlinkSync(resolve("node_modules"), join(root, "node_modules"), "dir");
    writeFileSync(
      join(root, "packages/proto/proto/spine-sources.json"),
      JSON.stringify({
        sources: [{ localPath: "packages/proto/proto/spine/frozen.proto" }],
        ownedSources: [{ localPath: "packages/proto/proto/spine/owned.proto" }],
      }),
    );
    writeFileSync(
      join(protoRoot, "frozen.proto"),
      'syntax = "proto3"; package spine.test; message Frozen { string value = 1; }',
    );
    writeFileSync(
      join(protoRoot, "owned.proto"),
      'syntax = "proto3"; package spine.test; message Owned { string value = 1; }',
    );
    const original = normalizedDescriptorDigest(buildFrozenDescriptorSet(root));

    writeFileSync(
      join(protoRoot, "owned.proto"),
      'syntax = "proto3"; package spine.test; message Owned { int64 changed = 1; }',
    );
    expect(normalizedDescriptorDigest(buildFrozenDescriptorSet(root))).toBe(original);

    writeFileSync(
      join(protoRoot, "frozen.proto"),
      'syntax = "proto3"; package spine.test; message Frozen { int64 changed = 1; }',
    );
    expect(normalizedDescriptorDigest(buildFrozenDescriptorSet(root))).not.toBe(original);
  });
});
