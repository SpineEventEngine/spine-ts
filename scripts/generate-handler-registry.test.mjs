import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { HandlerFilePublication, main } from "./generate-handler-registry.mjs";

describe("handler output publication", () => {
  it("rejects a symlinked adapter before touching an outside sentinel", async () => {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const app = mkdtempSync(join(repo, "packages/.handler-publication-"));
    const sentinel = join(mkdtempSync(join(tmpdir(), "spine-adapter-sentinel-")), "sentinel.js");
    try {
      mkdirSync(join(app, "src"));
      mkdirSync(join(app, "generated"));
      writeFileSync(sentinel, "untouched\n");
      symlinkSync(sentinel, join(app, "generated/spine-dependencies.js"));
      writeFileSync(
        join(app, "package.json"),
        '{"name":"@acme/handler-publication","version":"1.0.0","type":"module"}\n',
      );
      writeFileSync(
        join(app, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            module: "NodeNext",
            moduleResolution: "NodeNext",
            outDir: "dist",
            rootDir: ".",
          },
          include: ["src/**/*.ts"],
        }),
      );
      writeFileSync(join(app, "src/main.ts"), "export {};\n");
      expect(
        await main([
          "--repo-root",
          repo,
          "--project",
          join(app, "tsconfig.json"),
          "--generated-root",
          join(app, "generated"),
          "--out",
          join(app, "generated/spine-metadata.ts"),
        ]),
      ).toBe(1);
      expect(readFileSync(sentinel, "utf8")).toBe("untouched\n");
    } finally {
      rmSync(app, { recursive: true, force: true });
      rmSync(dirname(sentinel), { recursive: true, force: true });
    }
  });
  it("runs the ordinary handler generator with source and emitted adapters", async () => {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const app = mkdtempSync(join(repo, "packages/.handler-publication-"));
    try {
      mkdirSync(join(app, "src"));
      writeFileSync(
        join(app, "package.json"),
        '{"name":"@acme/handler-publication","version":"1.0.0","type":"module"}\n',
      );
      writeFileSync(
        join(app, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            module: "NodeNext",
            moduleResolution: "NodeNext",
            outDir: "dist",
            rootDir: ".",
          },
          include: ["src/**/*.ts"],
        }),
      );
      writeFileSync(join(app, "src/main.ts"), "export {};\n");
      const output = join(app, "generated/spine-metadata.ts");

      expect(
        await main([
          "--repo-root",
          repo,
          "--project",
          join(app, "tsconfig.json"),
          "--generated-root",
          join(app, "generated"),
          "--out",
          output,
        ]),
      ).toBe(0);
      expect(readFileSync(join(app, "generated/spine-bootstrap.ts"), "utf8")).toContain(
        'import "./spine-dependencies.js"',
      );
      expect(
        JSON.parse(readFileSync(join(app, "generated/spine-dependencies.json"), "utf8")),
      ).toHaveProperty("formatVersion", 2);
      expect(readFileSync(join(app, "dist/generated/spine-dependencies.js"), "utf8")).toContain(
        "export {};",
      );
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });
  it("restores all prior adapter and metadata bytes after a late write failure", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-handler-publication-"));
    const generated = join(root, "generated");
    mkdirSync(generated);
    const metadata = join(generated, "spine-metadata.ts");
    const adapter = join(generated, "spine-dependencies.js");
    writeFileSync(metadata, "prior metadata\n");
    writeFileSync(adapter, "prior adapter\n");

    expect(() =>
      HandlerFilePublication.publish([metadata, adapter], () => {
        writeFileSync(metadata, "next metadata\n");
        writeFileSync(adapter, "next adapter\n");
        throw new Error("injected late failure");
      }),
    ).toThrow("injected late failure");
    expect(readFileSync(metadata, "utf8")).toBe("prior metadata\n");
    expect(readFileSync(adapter, "utf8")).toBe("prior adapter\n");
  });
});
