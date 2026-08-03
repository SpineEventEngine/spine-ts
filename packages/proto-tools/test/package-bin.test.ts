import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  bin: { "spine-proto": string };
};
const bin = packageJson.bin["spine-proto"];

describe("spine-proto package binary", () => {
  it("exists before build and is included in the packed package", () => {
    expect(existsSync(join(packageRoot, bin))).toBe(true);

    const destination = mkdtempSync(join(tmpdir(), "spine-proto-pack-"));
    try {
      execFileSync(
        "pnpm",
        [
          "--dir",
          packageRoot,
          "pack",
          "--config.ignore-scripts=true",
          "--pack-destination",
          destination,
        ],
        { stdio: "pipe" },
      );
      const tarballs = readdirSync(destination).filter((file) => file.endsWith(".tgz"));
      expect(tarballs).toHaveLength(1);
      const tarballName = tarballs[0];
      if (tarballName === undefined) throw new Error("Expected one packed proto-tools tarball.");
      const tarball = join(destination, tarballName);
      const files = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" });

      expect(files).toContain(`package/${bin.slice(2)}\n`);
    } finally {
      rmSync(destination, { force: true, recursive: true });
    }
  });
});
