import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const root = new URL("..", import.meta.url).pathname;
const read = (name) => readFileSync(join(root, ".github/workflows", name), "utf8");
const approvedPnpmSetup = "0ebf47130e4866e96fce0953f49152a61190b271";

function npmSubcommand(command) {
  const tokens = command.trim().split(/\s+/u);
  if (tokens.shift() !== "npm") return undefined;
  const optionsWithValues = new Set(["--prefix", "--cache", "--userconfig", "--registry"]);
  while (tokens[0]?.startsWith("-")) {
    const option = tokens.shift();
    if (optionsWithValues.has(option)) tokens.shift();
  }
  return tokens[0];
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
    const publishRuns = workflow.jobs.publish.steps
      .map((step) => step.run)
      .filter((run) => typeof run === "string");
    expect(publishRuns).toContain(
      "node --version | grep -Fx 'v24.18.0' && npm --version | grep -Fx '11.16.0'",
    );
    expect(publishRuns.map(npmSubcommand)).not.toContain("install");
    expect(publishRuns.map(npmSubcommand)).not.toContain("i");
    expect(publishRuns.join("\n")).not.toMatch(/pnpm (?:install|add)|corepack/u);
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
  });

  it("uses only the reviewed pnpm setup release and recognizes option-prefixed npm installs", () => {
    const setupRefs = ["build.yml", "publish.yml"].flatMap((name) =>
      [...read(name).matchAll(/uses: pnpm\/action-setup@([a-f0-9]{40})/gu)].map(
        (match) => match[1],
      ),
    );
    expect(setupRefs).toEqual([approvedPnpmSetup, approvedPnpmSetup]);
    expect(npmSubcommand("npm --prefix x install")).toBe("install");
  });
});
