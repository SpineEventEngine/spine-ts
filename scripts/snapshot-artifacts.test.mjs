import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { describe, expect, it } from "vitest";

import { assertConsumerIsolation, isContainedRelative } from "./snapshot-artifacts.mjs";

describe("snapshot artifact containment", () => {
  it("rejects sibling-prefix and real symlink escapes", () => {
    const consumer = mkdtempSync(join(tmpdir(), "snapshot-consumer-"));
    const outside = mkdtempSync(join(tmpdir(), "snapshot-consumer-outside-"));
    try {
      mkdirSync(join(consumer, "node_modules"));
      symlinkSync(outside, join(consumer, "node_modules", "escape"));
      expect(() => assertConsumerIsolation(consumer)).toThrow("Consumer resolved repository path");
    } finally {
      rmSync(consumer, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects a win32 sibling escape independently of host platform", () => {
    expect(
      isContainedRelative(win32.relative("C:\\consumer", "C:\\consumer-sibling\\package")),
    ).toBe(false);
  });
});
