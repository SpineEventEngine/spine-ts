import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  auditWave8CurrentState,
  files,
  forbiddenArtifacts,
  manifest,
} from "./check-wave8-invention-audit.mjs";

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
  it("keeps the inventory's forbidden-artifact section in manifest parity", () => {
    const inventory = readFileSync("build-protocol/release/WAVE_8_INVENTION_AUDIT.md", "utf8");
    for (const { fixture } of manifest) expect(inventory).toContain(fixture);
  });

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

    expect(auditWave8CurrentState(root, files)).toEqual([
      "packages/server/src/legacy.ts:1: forbidden Wave 8 artifact: RemovalQuarantine",
    ]);
  });

  it("allows a truthful negative public-document statement", () => {
    const root = fixture();
    writeFileSync(join(root, "docs", "GUIDE.md"), "The runtime has no RemovalQuarantine.\n");

    expect(auditWave8CurrentState(root, files)).toEqual([]);
  });

  it.each([
    ["DeliveryReceipt", "receipt"],
    ["CommitReceipt", "receipt"],
    ["DeliveryMarker", "marker"],
    ["DedupRecord", "replacement dedup claim"],
    ["DeliveryClaim", "replacement dedup claim"],
  ])("rejects forbidden %s", (artifact, description) => {
    const root = fixture();
    writeFileSync(join(root, "packages", "server", "src", "legacy.ts"), `${artifact}\n`);

    expect(auditWave8CurrentState(root, files)).toEqual([
      `packages/server/src/legacy.ts:1: forbidden Wave 8 artifact: ${description}`,
    ]);
  });

  it("allows a precise negative statement for a retired shared layout", () => {
    const root = fixture();
    writeFileSync(join(root, "docs", "GUIDE.md"), "The adapter has no shared records table.\n");

    expect(auditWave8CurrentState(root, files)).toEqual([]);
  });

  it.each(forbiddenArtifacts)("rejects every manifest rule: %s", (name, expression) => {
    const root = fixture();
    writeFileSync(join(root, "packages", "server", "src", "legacy.ts"), `${expression}\n`);

    expect(auditWave8CurrentState(root, files)).toEqual([
      `packages/server/src/legacy.ts:1: forbidden Wave 8 artifact: ${name}`,
    ]);
  });

  it("does not let an executable or mixed positive/negative line bypass a rule", () => {
    const root = fixture();
    writeFileSync(
      join(root, "packages", "server", "src", "legacy.ts"),
      "// no RemovalQuarantine\n",
    );
    writeFileSync(
      join(root, "docs", "GUIDE.md"),
      "No old one, but RemovalQuarantine is supported.\n",
    );

    expect(auditWave8CurrentState(root, files)).toEqual([
      "docs/GUIDE.md:1: forbidden Wave 8 artifact: RemovalQuarantine",
      "packages/server/src/legacy.ts:1: forbidden Wave 8 artifact: RemovalQuarantine",
    ]);
  });

  it("rejects every versioned ApplicationNodeLease discovery key", () => {
    const root = fixture();
    writeFileSync(
      join(root, "packages", "server", "src", "legacy.ts"),
      "ApplicationNodeLease:v1\nApplicationNodeLease:v9\n",
    );
    expect(auditWave8CurrentState(root, files)).toEqual([
      "packages/server/src/legacy.ts:1: forbidden Wave 8 artifact: versioned discovery key",
      "packages/server/src/legacy.ts:2: forbidden Wave 8 artifact: versioned discovery key",
    ]);
  });

  it("scans only tracked current files in a real Git index", () => {
    const root = fixture();
    mkdirSync(join(root, "examples", "app", "src"), { recursive: true });
    mkdirSync(join(root, "generated"), { recursive: true });
    mkdirSync(join(root, ".worktrees", "old"), { recursive: true });
    writeFileSync(join(root, ".gitignore"), "generated/\n.worktrees/\n");
    writeFileSync(join(root, "examples", "app", "src", "view.tsx"), "RemovalQuarantine\n");
    writeFileSync(join(root, "untracked.ts"), "RemovalQuarantine\n");
    writeFileSync(join(root, "generated", "output.ts"), "RemovalQuarantine\n");
    writeFileSync(join(root, ".worktrees", "old", "stale.ts"), "RemovalQuarantine\n");
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", ".gitignore", "examples/app/src/view.tsx"], { cwd: root });

    expect(auditWave8CurrentState(root)).toEqual([
      "examples/app/src/view.tsx:1: forbidden Wave 8 artifact: RemovalQuarantine",
    ]);
  });

  it("fails closed when Git cannot enumerate the tracked current tree", () => {
    const root = fixture();
    writeFileSync(join(root, "packages", "server", "src", "legacy.ts"), "RemovalQuarantine\n");

    expect(() => auditWave8CurrentState(root)).toThrow(
      "Wave 8 audit requires tracked-file enumeration",
    );
  });
});
