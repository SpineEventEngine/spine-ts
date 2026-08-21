import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { describe, expect, it } from "vitest";

import {
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
  });
});
