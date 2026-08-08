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
    const leftBytes = CanonicalUtf8.bytes(left);
    const rightBytes = CanonicalUtf8.bytes(right);
    const length = Math.min(leftBytes.length, rightBytes.length);
    for (let index = 0; index < length; index += 1) {
      const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
      if (difference !== 0) return difference;
    }
    return leftBytes.length - rightBytes.length;
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
