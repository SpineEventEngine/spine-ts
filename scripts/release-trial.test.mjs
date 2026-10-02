import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createTrialServices, withProcessGuard } from "./release-trial.mjs";
import { executeRelease } from "./release-cli.mjs";

const entry = {
  name: "@spine-event-engine/proto",
  version: "2.0.0-snapshot.20",
  tarball: "spine-event-engine-proto-2.0.0-snapshot.20.tgz",
  integrity: "sha512-YQ==",
  dependencies: [],
};
const release = {
  sourceSha: "a".repeat(40),
  tag: "snapshot",
  version: entry.version,
  packages: [entry],
};

describe("offline release trial boundaries", () => {
  it("blocks the real npm subprocess when the injected spawn is ignored", async () => {
    const directory = mkdtempSync(join(tmpdir(), "spine-trial-guard-"));
    const original = childProcess.spawnSync;
    childProcess.spawnSync = (command, ...args) => {
      if (command === "npm") throw new Error("Outer test npm fence");
      return original(command, ...args);
    };
    syncBuiltinESMExports();
    try {
      await expect(
        withProcessGuard(directory, () =>
          executeRelease({
            input: directory,
            reportPath: join(directory, "report.json"),
            dependencies: {
              expected: { tag: release.tag, version: release.version, packages: [entry] },
              load: () => release,
              registry: async (kind) => (kind === "tags" ? {} : undefined),
              save: () => {},
            },
          }),
        ),
      ).rejects.toThrow("Blocked trial subprocess: npm");
      expect(spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).status).toBe(0);
    } finally {
      childProcess.spawnSync = original;
      syncBuiltinESMExports();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["missing input", ["--output", "/tmp/trial"]],
    ["missing output", ["--input", "/tmp/release"]],
    ["missing input value", ["--input", "--output", "/tmp/trial"]],
  ])("rejects %s with trial usage", (_name, args) => {
    const result = spawnSync(process.execPath, ["scripts/release-trial.mjs", ...args], {
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Trial requires --input and --output");
  });

  it("rejects every unexpected registry URL and npm command", async () => {
    const directory = mkdtempSync(join(tmpdir(), "spine-trial-boundary-"));
    try {
      const services = createTrialServices(release, directory);
      await expect(services.fetch("https://example.org/")).rejects.toThrow("Unexpected trial URL");
      await expect(
        services.fetch(`https://registry.npmjs.org/${encodeURIComponent(entry.name)}`, {
          method: "POST",
        }),
      ).rejects.toThrow("Unexpected trial HTTP request");
      expect(() => services.spawn("curl", [], {})).toThrow("Unexpected trial npm command");
      expect(services.published.size).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("simulates only exact registry reads and isolated npm publication arguments", async () => {
    const directory = mkdtempSync(join(tmpdir(), "spine-trial-service-"));
    const userConfig = join(directory, "user.npmrc");
    const globalConfig = join(directory, "global.npmrc");
    writeFileSync(userConfig, "");
    writeFileSync(globalConfig, "");
    try {
      const services = createTrialServices(release, directory);
      const encoded = encodeURIComponent(entry.name);
      expect((await services.fetch(`https://registry.npmjs.org/${encoded}`)).status).toBe(404);
      const result = services.spawn(
        "npm",
        [
          "publish",
          join(directory, entry.tarball),
          "--provenance",
          "--ignore-scripts",
          "--access",
          "public",
          "--tag",
          "snapshot",
          "--registry",
          "https://registry.npmjs.org/",
          "--json",
        ],
        {
          env: { NPM_CONFIG_USERCONFIG: userConfig, NPM_CONFIG_GLOBALCONFIG: globalConfig },
        },
      );
      expect(result.status).toBe(0);
      expect(services.published.has(entry.name)).toBe(true);
      expect(readFileSync(userConfig, "utf8")).toBe("");
      const tags = await services.fetch(
        `https://registry.npmjs.org/-/package/${encoded}/dist-tags`,
      );
      expect(await tags.json()).toEqual({ snapshot: entry.version, latest: "1.0.0" });
      const response = await services.fetch(
        `https://registry.npmjs.org/${encoded}/${entry.version}`,
      );
      expect((await response.json()).dist.integrity).toBe(entry.integrity);
      expect(services.calls).toBe(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps the selected latest tag at the newly published stable version", async () => {
    const stable = { ...entry, version: "2.0.0" };
    const services = createTrialServices(
      { ...release, tag: "latest", version: stable.version, packages: [stable] },
      "/tmp",
    );
    services.published.add(stable.name);
    const encoded = encodeURIComponent(entry.name);
    const tags = await services.fetch(`https://registry.npmjs.org/-/package/${encoded}/dist-tags`);
    expect(await tags.json()).toEqual({ latest: stable.version });
  });

  it("rejects a simulated npm upload that skips dependency order", () => {
    const next = { ...entry, name: "@spine-event-engine/core", tarball: "core.tgz" };
    const services = createTrialServices({ ...release, packages: [entry, next] }, "/tmp");
    expect(() =>
      services.spawn(
        "npm",
        [
          "publish",
          "/tmp/core.tgz",
          "--provenance",
          "--ignore-scripts",
          "--access",
          "public",
          "--tag",
          "snapshot",
          "--registry",
          "https://registry.npmjs.org/",
          "--json",
        ],
        {},
      ),
    ).toThrow("Trial publication order changed");
  });
});
