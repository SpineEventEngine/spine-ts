import { describe, expect, it } from "vitest";

import { copyrightHeader, recognizedCopyrightHeader } from "./copyright-header.mjs";

describe("copyright header", () => {
  it("recognizes only the approved template with a variable year", () => {
    expect(recognizedCopyrightHeader(copyrightHeader(2027))).toBe(copyrightHeader(2027));
    expect(
      recognizedCopyrightHeader(copyrightHeader(2027).replace("AS IS", "AS-IS")),
    ).toBeUndefined();
  });
});
