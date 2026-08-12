import { describe, expect, it } from "vitest";

import {
  copyrightHeader,
  recognizedCopyrightHeader,
  separateCopyrightHeader,
} from "./copyright-header.mjs";

describe("copyright header", () => {
  it("recognizes only the approved template with a variable year", () => {
    expect(recognizedCopyrightHeader(copyrightHeader(2027))).toBe(copyrightHeader(2027));
    expect(
      recognizedCopyrightHeader(copyrightHeader(2027).replace("AS IS", "AS-IS")),
    ).toBeUndefined();
  });

  it("normalizes zero and multiple empty lines after the approved header", () => {
    for (const following of [
      "import { value } from './value.js';\n",
      "export const value = true;\n",
      "// ordinary comment\n",
      "/** description */\n",
    ]) {
      expect(separateCopyrightHeader(`${copyrightHeader(2026)}${following}`)).toBe(
        `${copyrightHeader(2026)}\n${following}`,
      );
      expect(separateCopyrightHeader(`${copyrightHeader(2026)}\n\n${following}`)).toBe(
        `${copyrightHeader(2026)}\n${following}`,
      );
    }
  });
});
