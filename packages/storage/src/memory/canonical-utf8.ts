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

/**
 * Internal canonical UTF-8 ordering shared by in-memory storage components.
 */
export const CanonicalUtf8 = {
  // prettier-ignore

  /**
   * Compares strings by their canonical UTF-8 byte sequences.
   *
   * @param left The first string.
   * @param right The second string.
   * @returns A negative, zero, or positive comparison result.
   */
  compare(left: string, right: string): number {
    if (left === right) return 0;
    let leftIndex = 0;
    let rightIndex = 0;
    while (leftIndex < left.length && rightIndex < right.length) {
      const first = left.codePointAt(leftIndex);
      const second = right.codePointAt(rightIndex);
      if (first === undefined || second === undefined) break;
      const difference = first - second;
      if (difference !== 0) return difference;
      leftIndex += first > 0xffff ? 2 : 1;
      rightIndex += second > 0xffff ? 2 : 1;
    }
    return (leftIndex < left.length ? 1 : 0) - (rightIndex < right.length ? 1 : 0);
  },

  /**
   * Encodes a string as canonical UTF-8 bytes.
   *
   * @param value The string to encode.
   * @returns Its canonical UTF-8 byte sequence.
   */
  bytes(value: string): Uint8Array {
    const bytes: number[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const codePoint = value.codePointAt(index);
      if (codePoint === undefined) continue;
      if (codePoint > 0xffff) index++;
      if (codePoint <= 0x7f) bytes.push(codePoint);
      else if (codePoint <= 0x7ff) bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
      else if (codePoint <= 0xffff) {
        bytes.push(
          0xe0 | (codePoint >> 12),
          0x80 | ((codePoint >> 6) & 0x3f),
          0x80 | (codePoint & 0x3f),
        );
      } else {
        bytes.push(
          0xf0 | (codePoint >> 18),
          0x80 | ((codePoint >> 12) & 0x3f),
          0x80 | ((codePoint >> 6) & 0x3f),
          0x80 | (codePoint & 0x3f),
        );
      }
    }
    return new Uint8Array(bytes);
  },
};
