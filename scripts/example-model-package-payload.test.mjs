import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = new URL("..", import.meta.url).pathname;

const packages = [
  "@spine-event-engine/example-project-management",
  "@spine-event-engine/example-datastore-orders",
  "@spine-event-engine/users-model",
  "@spine-event-engine/chat-model",
];

describe("application model package payloads", () => {
  it.each(packages)(
    "includes an independently executable clean:generated-dist for %s",
    (packageName) => {
      const destination = mkdtempSync(join(tmpdir(), "spine-model-package-"));
      execFileSync(
        "pnpm",
        [
          "--config.ignore-scripts=true",
          "--filter",
          packageName,
          "pack",
          "--pack-destination",
          destination,
        ],
        {
          cwd: repositoryRoot,
          stdio: "pipe",
        },
      );
      const archive = join(
        destination,
        `${packageName.replace("@spine-event-engine/", "spine-event-engine-")}-0.0.0.tgz`,
      );
      execFileSync("tar", ["-xzf", archive, "-C", destination], { stdio: "pipe" });

      const packageRoot = join(destination, "package");
      const generated = join(packageRoot, "dist/generated/proof");
      mkdirSync(generated, { recursive: true });
      writeFileSync(join(generated, "stale.js"), "export {};\n");
      writeFileSync(join(packageRoot, "dist/tsconfig.tsbuildinfo"), "stale\n");
      execFileSync("node", ["scripts/clean-generated-dist.mjs"], {
        cwd: packageRoot,
        stdio: "pipe",
      });

      expect(existsSync(join(packageRoot, "scripts/clean-generated-dist.mjs"))).toBe(true);
      expect(existsSync(join(packageRoot, "dist/generated"))).toBe(false);
      expect(existsSync(join(packageRoot, "dist/tsconfig.tsbuildinfo"))).toBe(false);
    },
  );
});
