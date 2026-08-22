import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertNativeConsumerDependencyClosure,
  assertConsumerIsolation,
  isContainedRelative,
  proveExactTarballConsumer,
  proveNativeServerTarballConsumer,
} from "./snapshot-artifacts.mjs";
import { runBoundedCommand } from "./snapshot-test-command-runner.mjs";
import { terminationPlan, waitForChildClose } from "./snapshot-process-termination.mjs";
import { EventEmitter } from "node:events";

const repoRoot = new URL("..", import.meta.url).pathname;

describe("snapshot artifact containment", () => {
  it("selects taskkill without a negative PID on Windows", () => {
    expect(terminationPlan("win32", 42)).toEqual({
      command: "taskkill",
      args: ["/PID", "42", "/T", "/F"],
    });
  });
  it("clears the close wait timer when the child closes first", async () => {
    const child = new EventEmitter();
    let cleared = false;
    const wait = waitForChildClose(child, 10, {
      setTimeout: () => 1,
      clearTimeout: () => {
        cleared = true;
      },
    });
    child.emit("close");
    expect(await wait).toBe(true);
    expect(cleared).toBe(true);
  });
  it("removes the close listener when the wait times out", async () => {
    const child = new EventEmitter();
    let fire;
    let cleared = false;
    const wait = waitForChildClose(child, 10, {
      setTimeout: (fn) => ((fire = fn), 1),
      clearTimeout: () => {
        cleared = true;
      },
    });
    fire();
    expect(await wait).toBe(false);
    expect(cleared).toBe(true);
    expect(child.listenerCount("close")).toBe(0);
  });

  it("truncates noisy command diagnostics", () => {
    expect(() =>
      runBoundedCommand(
        process.execPath,
        ["--eval", "process.stderr.write('x'.repeat(20000)); process.exit(1)"],
        process.cwd(),
        1_000,
      ),
    ).toThrow(/\[output truncated\]/u);
  });
  it("does not hang when the direct command ignores SIGTERM", () => {
    const root = mkdtempSync(join(tmpdir(), "snapshot-direct-timeout-"));
    const pidFile = join(root, "direct.pid");
    const invocation = `import { runBoundedCommand } from ${JSON.stringify(new URL("./snapshot-test-command-runner.mjs", import.meta.url).href)}; runBoundedCommand(process.execPath, ['--eval', ${JSON.stringify(`const { writeFileSync } = require('node:fs'); process.on('SIGTERM', () => {}); writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`)}], ${JSON.stringify(root)}, 100);`;
    try {
      const result = spawnSync(process.execPath, ["--input-type=module", "--eval", invocation], {
        cwd: root,
        detached: process.platform !== "win32",
        timeout: 1_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      const pid = Number(readFileSync(pidFile, "utf8"));
      expect(waitForProcessExit(pid)).toBe(true);
    } finally {
      const pid = Number(readFileSync(pidFile, "utf8"));
      if (process.platform !== "win32") {
        try {
          process.kill(-pid, "SIGKILL");
        } catch (error) {
          if (error?.code !== "ESRCH") process.stderr.write(String(error));
        }
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports command output when a consumer command fails", () => {
    expect(() =>
      runBoundedCommand(
        process.execPath,
        ["--eval", "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)"],
        process.cwd(),
        1_000,
      ),
    ).toThrow(/out.*err/u);
  });
  it("terminates a timed-out command together with its forked descendant", () => {
    const root = mkdtempSync(join(tmpdir(), "snapshot-command-tree-"));
    const descendantPidFile = join(root, "descendant.pid");
    const descendantReadyFile = join(root, "descendant.ready");
    const parent = [
      "import { spawn } from 'node:child_process';",
      "import { existsSync, writeFileSync } from 'node:fs';",
      `const ready = ${JSON.stringify(descendantReadyFile)};`,
      "const child = spawn(process.execPath, ['--eval', \"import { writeFileSync } from 'node:fs'; process.on('SIGTERM', () => {}); writeFileSync(process.argv[1], 'ready'); setInterval(() => {}, 1000)\", ready], { stdio: 'ignore' });",
      "const started = setInterval(() => { if (!existsSync(ready)) return; clearInterval(started);",
      `writeFileSync(${JSON.stringify(descendantPidFile)}, String(child.pid));`,
      "setInterval(() => {}, 1000); }, 1);",
    ].join(" ");
    try {
      expect(() =>
        runBoundedCommand(process.execPath, ["--input-type=module", "--eval", parent], root, 500),
      ).toThrow(/timed out/u);
      const descendantPid = Number(readFileSync(descendantPidFile, "utf8"));
      expect(descendantPid).toBeGreaterThan(0);
      expect(waitForProcessExit(descendantPid)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

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
          run: (command, args, cwd) => runBoundedCommand(command, args, cwd, 60_000),
        }),
      ).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("installs, compiles, imports, and executes all exact framework tarballs", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-exact-tarball-consumer-"));
    try {
      expect(() =>
        proveExactTarballConsumer({
          root: repoRoot,
          destination: root,
          run: (command, args, cwd) => runBoundedCommand(command, args, cwd, 60_000),
        }),
      ).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);
});

function waitForProcessExit(pid) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return true;
      throw error;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  return false;
}
