import { mkdtempSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isContainedPath } from "./snapshot-artifacts.mjs";

describe("snapshot artifact containment", () => {
  it("rejects sibling-prefix and real symlink escapes", () => {
    const parent = mkdtempSync(join(tmpdir(), "snapshot-consumer-"));
    const sibling = parent + "-sibling";
    mkdirSync(sibling);
    const link = join(parent, "escape");
    symlinkSync(sibling, link);
    expect(isContainedPath(parent, sibling)).toBe(false);
    expect(isContainedPath(parent, realpathSync(link))).toBe(false);
  });
});
