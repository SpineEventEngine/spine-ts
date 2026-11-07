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

import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FieldnotesReaderProof } from "../src/reader-proof.js";

describe("Fieldnotes native reader proof", () => {
  it("verifies only exact canonical operation bytes under the pinned signing key", async () => {
    const first = new FieldnotesReaderProof(randomBytes(32));
    const second = new FieldnotesReaderProof(randomBytes(32));
    const bytes = new Uint8Array([1, 2, 3]);
    const proof = await first.issue(bytes);
    expect(await first.verify(bytes, proof)).toBe(true);
    expect(await first.verify(new Uint8Array([1, 2, 4]), proof)).toBe(false);
    expect(await second.verify(bytes, proof)).toBe(false);
    expect(await first.verify(bytes, "invalid")).toBe(false);
    await first.close();
    await second.close();
    expect(await first.verify(bytes, proof)).toBe(false);
  });
});
