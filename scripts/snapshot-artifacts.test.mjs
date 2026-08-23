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
import {
  processGroupLiveness,
  taskkillOutcome,
  terminationPlan,
  waitForChildClose,
} from "./snapshot-process-termination.mjs";
import { EventEmitter } from "node:events";

const repoRoot = new URL("..", import.meta.url).pathname;

describe("snapshot artifact containment", () => {
  it("selects taskkill without a negative PID on Windows", () => {
    expect(terminationPlan("win32", 42)).toEqual({
      command: "taskkill",
      args: ["/PID", "42", "/T", "/F"],
    });
  });
  it("classifies an inaccessible POSIX process group as not gone", () => {
    const errno = (code) => Object.assign(new Error(code), { code });

    expect(processGroupLiveness(42, () => undefined)).toBe("alive");
    expect(
      processGroupLiveness(42, () => {
        throw errno("ESRCH");
      }),
    ).toBe("gone");
    expect(
      processGroupLiveness(42, () => {
        throw errno("EPERM");
      }),
    ).toBe("inaccessible");
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
  it("accepts an already-closed child after taskkill reports failure", async () => {
    await expect(taskkillOutcome({ status: 1 }, async () => true)).resolves.toBe(true);
    await expect(taskkillOutcome({ status: 0 }, async () => false)).resolves.toBe(false);
    await expect(taskkillOutcome({ status: 1 }, async () => false)).rejects.toThrow("status 1");
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
    let primary;
    let cleanup;
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
    } catch (error) {
      primary = error;
    }
    try {
      const pid = Number(readFileSync(pidFile, "utf8"));
      if (!waitForProcessExit(pid)) {
        if (process.platform === "win32") {
          const plan = terminationPlan("win32", pid);
          const result = spawnSync(plan.command, plan.args, { stdio: "ignore" });
          if (result.error !== undefined || result.status !== 0)
            throw result.error ?? new Error("taskkill failed");
        } else {
          try {
            process.kill(-pid, "SIGKILL");
          } catch (error) {
            if (error?.code !== "ESRCH") throw error;
          }
        }
        if (!waitForProcessExit(pid)) throw new Error("Emergency process cleanup failed.");
      }
    } catch (error) {
      cleanup = error;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    if (primary !== undefined && cleanup !== undefined)
      throw new AggregateError([primary, cleanup]);
    if (primary !== undefined) throw primary;
    if (cleanup !== undefined) throw cleanup;
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
        runBoundedCommand(
          process.execPath,
          ["--input-type=module", "--eval", parent],
          root,
          500,
          descendantPidFile,
        ),
      ).toThrow(/timed out/u);
      const descendantPid = Number(readFileSync(descendantPidFile, "utf8"));
      expect(descendantPid).toBeGreaterThan(0);
      expect(waitForProcessExit(descendantPid)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("terminates a command group that never publishes readiness", () => {
    const root = mkdtempSync(join(tmpdir(), "snapshot-command-not-ready-"));
    const ready = join(root, "never-ready");
    try {
      expect(() =>
        runBoundedCommand(
          process.execPath,
          ["--eval", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
          root,
          100,
          ready,
        ),
      ).toThrow(/did not publish readiness signal/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports an immediate spawn error without waiting for readiness", () => {
    expect(() =>
      runBoundedCommand("definitely-not-a-spine-command", [], process.cwd(), 100, "missing-ready"),
    ).toThrow(/ENOENT/u);
  });

  it("cleans an ignoring descendant after parent exits before readiness", () => {
    const root = mkdtempSync(join(tmpdir(), "snapshot-early-exit-"));
    const pidFile = join(root, "descendant.pid");
    try {
      const parent = `const { spawn } = require('node:child_process'); const { writeFileSync } = require('node:fs'); const child = spawn(process.execPath, ['--eval', ${JSON.stringify("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)")}], { stdio: 'ignore' }); writeFileSync(${JSON.stringify(pidFile)}, String(child.pid)); child.unref();`;
      expect(() =>
        runBoundedCommand(process.execPath, ["--eval", parent], root, 100, join(root, "ready")),
      ).toThrow(/exited before readiness/u);
      expect(waitForProcessExit(Number(readFileSync(pidFile, "utf8")))).toBe(true);
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
      let browserConsumerSource;
      expect(() =>
        proveExactTarballConsumer({
          root: repoRoot,
          destination: root,
          run: (command, args, cwd) => {
            if (args.at(-1) === "tsconfig.json")
              browserConsumerSource = readFileSync(join(cwd, "index.ts"), "utf8");
            runBoundedCommand(command, args, cwd, 60_000);
          },
        }),
      ).not.toThrow();
      expect(browserConsumerSource).toContain('from "@spine-event-engine/server/browser"');
      expect(browserConsumerSource).toContain('import "@spine-event-engine/auth"');
      expect(browserConsumerSource).toContain("fetch(`${browser.baseUrl}/auth/probe`)");
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
