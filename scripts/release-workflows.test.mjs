import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const root = new URL("..", import.meta.url).pathname;
const read = (name) => readFileSync(join(root, ".github/workflows", name), "utf8");
const approvedPnpmSetup = "0ebf47130e4866e96fce0953f49152a61190b271";
const npmVersionCheck =
  "node --version | grep -Fx 'v24.18.0' && npm --version | grep -Fx '11.16.0'";
const scopedLernaPublish =
  [
    "set -euo pipefail",
    'scope_file="$RUNNER_TEMP/spine-lerna-scopes"',
    "trap 'rm -f \"$scope_file\"' EXIT",
    'node scripts/release-cli.mjs scopes > "$scope_file"',
    'test -s "$scope_file"',
    'mapfile -t scopes < "$scope_file"',
    'test "${#scopes[@]}" -gt 0',
    "scope_args=()",
    'for name in "${scopes[@]}"; do scope_args+=(--scope "$name"); done',
    'TAG="$(node scripts/release-cli.mjs tag)"',
    'pnpm exec lerna publish from-package "${scope_args[@]}" --contents .publish --concurrency 1 --ignore-scripts --dist-tag "$TAG" --registry https://registry.npmjs.org/ --git-head "$GITHUB_SHA" --summary-file "$GITHUB_STEP_SUMMARY" --yes',
  ].join("\n") + "\n";
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
    uses: "pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271",
    with: { version: "11.9.0" },
  },
  { run: "pnpm install --frozen-lockfile --ignore-scripts" },
  {
    uses: "actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0",
    with: { name: "release", path: "${{ github.workspace }}" },
  },
  { run: scopedLernaPublish },
  { run: "node scripts/release-cli.mjs verify-registry" },
];
const publishJobAllowlist = {
  needs: "prepare",
  "runs-on": "ubuntu-24.04",
  environment: "gh-actions-environment",
  permissions: { contents: "read", "id-token": "write" },
  steps: publishStepsAllowlist,
};
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
  "pnpm/action-setup@" + approvedPnpmSetup,
  "actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0",
];

function assertExactPublishSteps(steps) {
  expect(steps).toEqual(publishStepsAllowlist);
}

function assertExactPublishJob(job) {
  expect(Object.keys(job).sort()).toEqual([
    "environment",
    "needs",
    "permissions",
    "runs-on",
    "steps",
  ]);
  expect(job).toEqual(publishJobAllowlist);
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

  it("fetches history for release verification without widening the publish job", () => {
    const build = YAML.parse(read("build.yml"));
    const publication = YAML.parse(read("publish.yml"));
    expect(build.jobs.verify.steps[0].with).toEqual({
      "persist-credentials": false,
      "fetch-depth": 0,
    });
    expect(publication.jobs.prepare.steps[0].with).toEqual({
      ref: "${{ github.sha }}",
      "persist-credentials": false,
      "fetch-depth": 0,
    });
    expect(publication.jobs.publish.steps[0]).toEqual(publishStepsAllowlist[0]);
    expect(publication.jobs.prepare.steps.at(-1)).toEqual({
      uses: "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
      with: {
        name: "release",
        path: "${{ runner.temp }}/release",
        "if-no-files-found": "error",
        "include-hidden-files": true,
        "retention-days": 1,
      },
    });
  });

  it("isolates OIDC publication after exact prepared artifacts", () => {
    const source = read("publish.yml");
    const workflow = YAML.parse(source);
    expect(workflow.on.push.branches).toEqual(["master"]);
    expect(workflow.concurrency).toEqual({
      group: "spine-npm-publication",
      queue: "max",
      "cancel-in-progress": false,
    });
    assertExactPublishJob(workflow.jobs.publish);
    expect(source).toContain("pnpm/action-setup@" + approvedPnpmSetup + " # v6.0.9");
    expect(source).toContain("node-version: 24.18.0");
    expect(source).toContain("npm --version | grep -Fx '11.16.0'");
    expect(source).toContain(
      "actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0 # v5",
    );
    expect(source).not.toMatch(
      /secrets\.|npm login|whoami|unpublish|provenance=false|snapshot-publisher/u,
    );
    expect(source).toContain("lerna publish from-package");
    expect(source).toContain("set -euo pipefail");
    expect(source).toContain('node scripts/release-cli.mjs scopes > "$scope_file"');
    expect(source).toContain('"${scope_args[@]}" --contents .publish');
    expect(source).not.toContain("lerna publish from-package --contents");
    expect(source).not.toContain("release-publisher");
    expect(readFileSync(join(root, "scripts/release-cli.mjs"), "utf8")).not.toMatch(
      /release-publisher|publishRelease|createPublicRegistry/u,
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

  it("rejects unreviewed publish-job metadata", () => {
    const job = YAML.parse(read("publish.yml")).jobs.publish;
    for (const addition of [
      { permissions: { ...job.permissions, packages: "write" } },
      { env: { PATH: "/tmp" } },
      { if: "always()" },
      { container: "node:24" },
    ])
      expect(() => assertExactPublishJob({ ...job, ...addition })).toThrow();
  });
});
