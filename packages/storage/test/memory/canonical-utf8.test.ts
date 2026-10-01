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

import { describe, expect, it, vi } from "vitest";

import { CanonicalUtf8 } from "../../src/memory/canonical-utf8.js";

function byteComparison(left: string, right: string): number {
  const first = CanonicalUtf8.bytes(left);
  const second = CanonicalUtf8.bytes(right);
  for (let index = 0; index < Math.min(first.length, second.length); index += 1) {
    const difference = (first[index] ?? 0) - (second[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return first.length - second.length;
}

describe("canonical UTF-8 comparison", () => {
  it("agrees in sign with the byte comparator for Unicode and lone surrogates", () => {
    const parts = [
      "",
      "a",
      "z",
      "é",
      "\u07ff",
      "\u0800",
      "\uE000",
      "\u{10000}",
      "\u{10ffff}",
      "\uD800",
      "\uDC00",
    ];
    const strings = parts.flatMap((first) => parts.map((second) => first + second));

    for (const left of strings) {
      for (const right of strings) {
        expect(Math.sign(CanonicalUtf8.compare(left, right))).toBe(
          Math.sign(byteComparison(left, right)),
        );
      }
    }
  });

  it("compares without allocating encoded byte arrays", () => {
    const bytes = vi.spyOn(CanonicalUtf8, "bytes");
    try {
      expect(CanonicalUtf8.compare("same", "same")).toBe(0);
      expect(CanonicalUtf8.compare("\uE000", "\u{10000}")).toBeLessThan(0);
      expect(bytes).not.toHaveBeenCalled();
    } finally {
      bytes.mockRestore();
    }
  });
});
