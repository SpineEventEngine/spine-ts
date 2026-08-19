// Proves temporary image-build files are removed when a build is interrupted.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { URL } from "node:url";

import { BuildContextCleanup } from "./build-context-cleanup.mjs";

test("image build cleanup removes staging data before restoring each signal", () => {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const directory = mkdtempSync(join(tmpdir(), "spine-image-cleanup-test-"));
    writeFileSync(join(directory, "sentinel"), "temporary");
    const runtime = new EventEmitter();
    const terminations = [];
    const cleanup = new BuildContextCleanup(directory, runtime, (received) => {
      terminations.push(received);
      assert.equal(existsSync(directory), false);
    });
    cleanup.install();

    runtime.emit(signal);
    cleanup.clean();

    assert.deepEqual(terminations, [signal]);
    assert.equal(runtime.listenerCount("SIGINT"), 0);
    assert.equal(runtime.listenerCount("SIGTERM"), 0);
  }
});

test("image build cleanup removes staging data after a failed build", () => {
  const directory = mkdtempSync(join(tmpdir(), "spine-image-failure-test-"));
  const cleanup = new BuildContextCleanup(directory);
  try {
    assert.throws(() => {
      throw new Error("build failed");
    }, /build failed/u);
  } finally {
    cleanup.clean();
  }
  assert.equal(existsSync(directory), false);
});

test("image builder applies one finite bound to every subprocess", () => {
  const source = readFileSync(new URL("build-local-images.mjs", import.meta.url), "utf8");
  assert.equal(source.match(/execFileSync\(/gu)?.length, 1);
  assert.match(source, /timeout: subprocessTimeoutMs/u);
  assert.doesNotMatch(source, /pnpm@11\.9\.0/u);
});
