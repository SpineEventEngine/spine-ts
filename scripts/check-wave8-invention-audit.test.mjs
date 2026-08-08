import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { auditWave8CurrentState } from "./check-wave8-invention-audit.mjs";

const fixtures = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "spine-wave8-audit-"));
  fixtures.push(root);
  mkdirSync(join(root, "packages", "server", "src"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "build-protocol", "work-logs"), { recursive: true });
  return root;
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("Wave 8 invention audit", () => {
  it("rejects a forbidden runtime artifact while excluding historical evidence", () => {
    const root = fixture();
    writeFileSync(
      join(root, "packages", "server", "src", "legacy.ts"),
      "class RemovalQuarantine {}\n",
    );
    writeFileSync(
      join(root, "build-protocol", "work-logs", "T-0139.md"),
      "RemovalQuarantine was removed.\n",
    );

    expect(auditWave8CurrentState(root)).toEqual([
      "packages/server/src/legacy.ts:1: forbidden Wave 8 artifact: RemovalQuarantine",
    ]);
  });

  it("allows a truthful negative public-document statement", () => {
    const root = fixture();
    writeFileSync(join(root, "docs", "GUIDE.md"), "The runtime has no RemovalQuarantine.\n");

    expect(auditWave8CurrentState(root)).toEqual([]);
  });

  it.each([
    ["DeliveryReceipt", "receipt"],
    ["DeliveryMarker", "marker"],
    ["DedupRecord", "replacement dedup claim"],
    ["DeliveryClaim", "replacement dedup claim"],
  ])("rejects forbidden %s", (artifact, description) => {
    const root = fixture();
    writeFileSync(join(root, "packages", "server", "src", "legacy.ts"), `${artifact}\n`);

    expect(auditWave8CurrentState(root)).toEqual([
      `packages/server/src/legacy.ts:1: forbidden Wave 8 artifact: ${description}`,
    ]);
  });

  it("allows a precise negative statement for a retired shared layout", () => {
    const root = fixture();
    writeFileSync(join(root, "docs", "GUIDE.md"), "The adapter has no shared records table.\n");

    expect(auditWave8CurrentState(root)).toEqual([]);
  });
});
