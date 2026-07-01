import { describe, expect, it } from "vitest";

import { RecordMask } from "../../src/index.js";

describe("RecordMask", () => {
  it("applies record masks through nested arrays", () => {
    const masked = RecordMask.apply(
      {
        items: [
          { keep: 1, drop: 2 },
          { keep: 3, drop: 4 },
        ],
        drop: true,
      },
      ["items.keep"],
    );

    expect(masked).toEqual({
      items: [{ keep: 1 }, { keep: 3 }],
    });
  });
});
