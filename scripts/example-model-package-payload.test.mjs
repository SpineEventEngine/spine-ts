import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = new URL("..", import.meta.url).pathname;

const packages = [
  { name: "@spine-event-engine/example-project-management", path: "examples/projects" },
  { name: "@spine-event-engine/example-datastore-orders", path: "examples/orders" },
  { name: "@spine-event-engine/example-message-board-model", path: "examples/message-board/model" },
];

describe("application model package payloads", () => {
  it.each(packages)(
    "includes an independently executable clean:generated-dist for $name",
    ({ name: packageName, path }) => {
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
        `${packageName.replace("@spine-event-engine/", "spine-event-engine-")}-${
          JSON.parse(readFileSync(join(repositoryRoot, path, "package.json"), "utf8")).version
        }.tgz`,
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
