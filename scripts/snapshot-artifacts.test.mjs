import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertNativeConsumerDependencyClosure,
  assertConsumerIsolation,
  isContainedRelative,
  proveNativeServerTarballConsumer,
} from "./snapshot-artifacts.mjs";

const repoRoot = new URL("..", import.meta.url).pathname;

describe("snapshot artifact containment", () => {
  it("rejects sibling-prefix and real symlink escapes", () => {
    const consumer = mkdtempSync(join(tmpdir(), "snapshot-consumer-"));
    const outside = mkdtempSync(join(tmpdir(), "snapshot-consumer-outside-"));
    try {
      mkdirSync(join(consumer, "node_modules"));
      symlinkSync(outside, join(consumer, "node_modules", "escape"));
      expect(() => assertConsumerIsolation(consumer)).toThrow("Consumer resolved repository path");
    } finally {
      rmSync(consumer, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects a win32 sibling escape independently of host platform", () => {
    expect(
      isContainedRelative(win32.relative("C:\\consumer", "C:\\consumer-sibling\\package")),
    ).toBe(false);
  });

  it("rejects forbidden packages installed beneath pnpm's virtual store", () => {
    const consumer = mkdtempSync(join(tmpdir(), "snapshot-native-consumer-"));
    try {
      for (const [directory, name] of [
        ["typescript@6.0.3/node_modules/typescript", "typescript"],
        [
          "@spine-event-engine+auth@2.0.0/node_modules/@spine-event-engine/auth",
          "@spine-event-engine/auth",
        ],
      ]) {
        const packageDirectory = join(consumer, "node_modules", ".pnpm", directory);
        mkdirSync(packageDirectory, { recursive: true });
        writeFileSync(join(packageDirectory, "package.json"), JSON.stringify({ name }));
      }
      expect(() => assertNativeConsumerDependencyClosure(consumer)).toThrow(
        "Native server consumer installed forbidden package: @spine-event-engine/auth",
      );
    } finally {
      rmSync(consumer, { recursive: true, force: true });
    }
  });

  it("installs, compiles, and imports a native server consumer without auth or compiler packages", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-native-server-consumer-"));
    try {
      expect(() =>
        proveNativeServerTarballConsumer({
          root: repoRoot,
          destination: root,
          run: (command, args, cwd) =>
            execFileSync(command, args, { cwd, stdio: "pipe", timeout: 30_000 }),
        }),
      ).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
