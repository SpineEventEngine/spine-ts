/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

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
