import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const root = new URL("..", import.meta.url).pathname;
const read = (name) => readFileSync(join(root, ".github/workflows", name), "utf8");

describe("release workflows", () => {
  it("keeps PR checks read-only and exercises the real-library Rekor fixture", () => {
    const build = YAML.parse(read("build.yml"));
    const steps = build.jobs.verify.steps;
    expect(build.permissions).toEqual({ contents: "read" });
    expect(steps.map(({ uses }) => uses)).toContain("./.github/actions/prepare-release");
    expect(steps.find(({ with: settings }) => settings?.name === "release")).toBeDefined();
    const trial = build.jobs.trial;
    expect(trial.needs).toBe("verify");
    expect(trial.steps.some(({ with: settings }) => settings?.name === "release")).toBe(true);
    expect(trial.steps.map(({ run }) => run)).toContain(
      'node scripts/release-trial.mjs --input "$RUNNER_TEMP/release" --output "$RUNNER_TEMP/publication-trial-report"',
    );
    const report = trial.steps.find(
      ({ with: settings }) => settings?.name === "publication-trial-report",
    );
    expect(report.if).toBe("always()");
    expect(report.with.path).toBe("${{ runner.temp }}/publication-trial-report");
    expect(trial.steps.some(({ with: settings }) => settings?.name === "publication-report")).toBe(
      false,
    );
    expect(trial.steps.some(({ run }) => run?.includes("pnpm install"))).toBe(false);
    expect(trial.steps.some(({ uses }) => uses?.startsWith("pnpm/"))).toBe(false);
    expect(
      trial.steps.find(({ uses }) => uses?.startsWith("actions/setup-node@")).with,
    ).toMatchObject({
      "node-version": "24.18.0",
      "package-manager-cache": false,
    });
    expect(read("build.yml")).not.toMatch(/id-token|npm publish|secrets\./u);
  });

  it("shares pinned preparation steps and runs audits before release verification", () => {
    const action = YAML.parse(
      readFileSync(join(root, ".github/actions/prepare-release/action.yml"), "utf8"),
    );
    const runs = action.runs.steps.map(({ run }) => run).filter(Boolean);
    expect(action.runs.using).toBe("composite");
    expect(
      action.runs.steps.find(({ uses }) => uses?.startsWith("pnpm/action-setup@")).with,
    ).toEqual({
      version: "11.9.0",
    });
    expect(runs).toContain("pnpm install --frozen-lockfile --ignore-scripts");
    expect(runs.indexOf("pnpm audit:release")).toBeLessThan(runs.indexOf("pnpm verify:release"));
    expect(runs).toContain("node --test scripts/npm-rekor-recovery.repro.mjs");
    expect(runs).toContain('node scripts/release-cli.mjs prepare --output "$RUNNER_TEMP/release"');
    for (const name of ["build.yml", "publish.yml"])
      expect(
        YAML.parse(read(name)).jobs[name === "build.yml" ? "verify" : "prepare"].steps.map(
          ({ uses }) => uses,
        ),
      ).toContain("./.github/actions/prepare-release");
  });

  it("separates verified archive preparation from token-free OIDC publication", () => {
    const workflow = YAML.parse(read("publish.yml"));
    const prepare = workflow.jobs.prepare;
    const publish = workflow.jobs.publish;
    expect(workflow.on.push.branches).toEqual(["master"]);
    expect(workflow.concurrency).toEqual({
      group: "spine-npm-publication",
      queue: "max",
      "cancel-in-progress": false,
    });
    expect(prepare.steps.map(({ uses }) => uses)).toContain("./.github/actions/prepare-release");
    expect(publish.permissions).toEqual({ contents: "read", actions: "read", "id-token": "write" });
    const command = publish.steps.find(({ run }) => run?.includes("release-cli.mjs publish")).run;
    expect(command).toContain(
      'node scripts/release-cli.mjs publish --input "$RUNNER_TEMP/release"',
    );
    expect(command).toContain('--report "$RUNNER_TEMP/publication-report.json"');
    expect(command).toContain('--prior-report "$RUNNER_TEMP/prior/publication-report.json"');
    expect(publish.steps.some(({ run }) => run?.includes("pnpm install"))).toBe(false);
    expect(read("publish.yml")).not.toMatch(/lerna|npm login|NODE_AUTH_TOKEN|NPM_TOKEN|secrets\./u);
  });

  it("requires prior evidence on rerun and uploads the attempt report even on failure", () => {
    const steps = YAML.parse(read("publish.yml")).jobs.publish.steps;
    const previous = steps.find(
      ({ with: settings }) => settings?.name === "publication-report" && settings?.["run-id"],
    );
    const upload = steps.find(
      ({ with: settings }) => settings?.name === "publication-report" && settings?.overwrite,
    );
    expect(previous.if).toBe("github.run_attempt != '1'");
    expect(previous.with["run-id"]).toBe("${{ github.run_id }}");
    expect(upload.if).toBe("always()");
    expect(upload.with.path).toBe("${{ runner.temp }}/publication-report.json");
  });

  it("pins actions and disables persisted checkout credentials", () => {
    for (const name of ["build.yml", "publish.yml", "security.yml"]) {
      const source = read(name);
      expect(
        [...source.matchAll(/uses: [^@]+@([^\s]+)/gu)].every((match) =>
          /^[a-f0-9]{40}$/u.test(match[1]),
        ),
      ).toBe(true);
      const workflow = YAML.parse(source);
      for (const job of Object.values(workflow.jobs))
        for (const step of job.steps.filter(({ uses }) => uses?.startsWith("actions/checkout@")))
          expect(step.with["persist-credentials"]).toBe(false);
    }
  });
});
