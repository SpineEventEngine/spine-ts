import { describe, expect, it } from "vitest";

import { RelativeTime } from "../src/relative-time.js";

describe("RelativeTime", () => {
  it("uses the MessageBoard age vocabulary at every boundary", () => {
    const now = new Date("2026-07-31T12:00:00.000Z");

    expect(RelativeTime.format(new Date("2026-07-31T11:59:01.000Z"), now)).toBe("just now");
    expect(RelativeTime.format(new Date("2026-07-31T11:59:00.000Z"), now)).toBe("1 minute ago");
    expect(RelativeTime.format(new Date("2026-07-31T11:57:00.000Z"), now)).toBe("3 minutes ago");
    expect(RelativeTime.format(new Date("2026-07-31T09:00:00.000Z"), now)).toBe("3 hours ago");
    expect(RelativeTime.format(new Date("2026-07-29T12:00:00.000Z"), now)).toBe("2 days ago");
  });
});
