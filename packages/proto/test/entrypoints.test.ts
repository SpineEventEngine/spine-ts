import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function resolveEntrypoint(specifier: string) {
  return spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `await import(${JSON.stringify(specifier)});`],
    { cwd: resolve("packages/proto"), encoding: "utf8" },
  );
}

describe("@spine-event-engine/proto package entrypoints", () => {
  it("exposes only the curated root and Wave 1 contract groups", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve("packages/proto/package.json"), "utf8"),
    ) as { exports: Record<string, unknown> };

    expect(Object.keys(packageJson.exports).sort()).toEqual(
      [".", "./client", "./delivery", "./delivery-server"].sort(),
    );
  });

  it("resolves every supported package entrypoint and rejects private paths", () => {
    for (const supported of [
      "@spine-event-engine/proto",
      "@spine-event-engine/proto/client",
      "@spine-event-engine/proto/delivery",
      "@spine-event-engine/proto/delivery-server",
    ]) {
      expect(resolveEntrypoint(supported).status, supported).toBe(0);
    }

    for (const privatePath of [
      "@spine-event-engine/proto/generated/spine/core/command_pb.js",
      "@spine-event-engine/proto/runtime",
    ]) {
      const result = resolveEntrypoint(privatePath);
      expect(result.status, privatePath).toBe(1);
      expect(result.stderr).toContain("ERR_PACKAGE_PATH_NOT_EXPORTED");
    }
  });

  it("keeps end-user guides and the Todo smoke runner on supported imports", () => {
    for (const consumerPath of [
      "docs/USER_GUIDE.md",
      "examples/todo/USER_GUIDE.md",
      "examples/todo/scripts/smoke.mjs",
    ]) {
      const contents = readFileSync(resolve(consumerPath), "utf8");
      expect(contents, consumerPath).not.toContain("@spine-event-engine/proto/generated/");
    }
  });
});
