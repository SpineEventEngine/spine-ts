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
