import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const root = new URL("..", import.meta.url).pathname;
const read = (name) => readFileSync(join(root, ".github/workflows", name), "utf8");
const approvedPnpmSetup = "0ebf47130e4866e96fce0953f49152a61190b271";
const npmVersionCheck =
  "node --version | grep -Fx 'v24.18.0' && npm --version | grep -Fx '11.16.0'";
const publishStepsAllowlist = [
  {
    uses: "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
    with: { ref: "${{ github.sha }}", "persist-credentials": false },
  },
  {
    uses: "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
    with: { "node-version": "24.18.0", "package-manager-cache": false },
  },
  { run: npmVersionCheck },
  {
    uses: "actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0",
    with: { name: "release", path: "${{ runner.temp }}/release" },
  },
  { run: 'node scripts/release-cli.mjs publish --input "$RUNNER_TEMP/release"' },
];
const usesAllowlist = [
  "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
  "pnpm/action-setup@" + approvedPnpmSetup,
  "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
  "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
  "pnpm/action-setup@" + approvedPnpmSetup,
  "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
  "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
  "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
  "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
  "actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0",
];

function assertExactPublishSteps(steps) {
  expect(steps).toEqual(publishStepsAllowlist);
}

describe("release workflows", () => {
  it("keeps PR verification read-only and non-publishing", () => {
    const source = read("build.yml");
    const workflow = YAML.parse(source);
    expect(workflow.on.pull_request.branches).toEqual(["master"]);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(source).toContain(
      "pnpm verify:release\n      - run: node scripts/release-cli.mjs prepare --check",
    );
    expect(source).not.toMatch(/publish|id-token|environment|secrets\./u);
  });

  it("isolates OIDC publication after exact prepared artifacts", () => {
    const source = read("publish.yml");
    const workflow = YAML.parse(source);
    expect(workflow.on.push.branches).toEqual(["master"]);
    expect(workflow.concurrency).toMatchObject({
      group: "spine-npm-publication",
      queue: "max",
      "cancel-in-progress": false,
    });
    expect(workflow.jobs.publish).toMatchObject({
      needs: "prepare",
      environment: "gh-actions-environment",
      permissions: { contents: "read", "id-token": "write" },
    });
    expect(source).toContain("pnpm/action-setup@" + approvedPnpmSetup + " # v6.0.9");
    assertExactPublishSteps(workflow.jobs.publish.steps);
    expect(source).toContain("node-version: 24.18.0");
    expect(source).toContain("npm --version | grep -Fx '11.16.0'");
    expect(source).toContain(
      "actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0 # v5",
    );
    expect(source).not.toMatch(
      /secrets\.|npm login|whoami|dist-tag|unpublish|provenance=false|snapshot-publisher/u,
    );
  });

  it("pins every action to a full immutable SHA and disables checkout credentials", () => {
    for (const name of ["build.yml", "publish.yml"]) {
      const source = read(name);
      expect(
        [...source.matchAll(/uses: [^@]+@([^\s]+)/gu)].every((match) =>
          /^[a-f0-9]{40}$/u.test(match[1]),
        ),
      ).toBe(true);
      expect(source).toContain("persist-credentials: false");
      expect(source).toContain("package-manager-cache: false");
    }
    const uses = ["build.yml", "publish.yml"].flatMap((name) => {
      const workflow = YAML.parse(read(name));
      return Object.values(workflow.jobs).flatMap((job) =>
        job.steps.filter((step) => typeof step.uses === "string").map((step) => step.uses),
      );
    });
    expect(uses).toEqual(usesAllowlist);
  });

  it("rejects step-level execution controls on an otherwise allowed run", () => {
    const workflow = YAML.parse(read("publish.yml"));
    const allowedSteps = workflow.jobs.publish.steps;
    for (const change of [
      { shell: "bash -e {0}" },
      { "working-directory": "/tmp" },
      { env: { PATH: "/tmp" } },
    ]) {
      const steps = JSON.parse(JSON.stringify(allowedSteps));
      Object.assign(steps[2], change);
      expect(() => assertExactPublishSteps(steps)).toThrow();
    }
  });
});
