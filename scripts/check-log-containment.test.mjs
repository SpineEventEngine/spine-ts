import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

test("requires every containment comment to have one manifest entry", () => {
  const root = mkdtempSync(join(tmpdir(), "spine-log-check-"));
  writeFileSync(join(root, "source.ts"), "// spine-log-boundary: retry\ntry {} catch {}\n");
  writeFileSync(
    join(root, "manifest.json"),
    JSON.stringify({ boundaries: [{ id: "retry", source: "source.ts", operation: "retry", disposition: "no-log", test: "fixture" }] }),
  );
  const result = spawnSync(process.execPath, ["scripts/check-log-containment.mjs", join(root, "manifest.json")], {
    cwd: process.cwd(), encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /empty catch/);
});
