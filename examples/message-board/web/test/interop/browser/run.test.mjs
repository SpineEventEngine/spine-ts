// Checks the browser-acceptance runner's cleanup and observable test sequencing.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import test from "node:test";
import { setImmediate } from "node:timers";

import {
  recordPassiveViewerPrecondition,
  recordPassiveViewerProgress,
  runBrowserAcceptance,
  settleTopology,
  spawnPlaywright,
} from "./run.mjs";

test("rejects when the Playwright child cannot spawn", async () => {
  const expected = new Error("playwright executable is unavailable");
  const child = new EventEmitter();
  let childArguments;
  const promise = spawnPlaywright({
    binary: "/missing/playwright",
    arguments_: [],
    cwd: "/fixture",
    environment: {},
    spawnChild: (_binary, arguments_) => {
      childArguments = arguments_;
      return child;
    },
  });
  child.emit("error", expected);

  await assert.rejects(promise, expected);
  assert.deepEqual(childArguments?.slice(0, 3), ["test", "-c", "playwright.config.mjs"]);
});

test("drains fragmented and coalesced stdout after child exit before close", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const lines = [];
  const running = spawnPlaywright({
    binary: "/fixture/playwright",
    arguments_: [],
    cwd: "/fixture",
    environment: {},
    spawnChild: () => child,
    onOutput: (line) => lines.push(line),
  });

  child.stdout.emit("data", Buffer.from("first\nPASSIVE_"));
  child.stdout.emit("data", Buffer.from("VIEWER_UPDATE 1\nsecond\nthird"));
  child.emit("exit", 0);
  child.stdout.emit("data", Buffer.from("\nfourth"));
  child.emit("close", 0);

  await running;
  assert.deepEqual(lines, ["first", "PASSIVE_VIEWER_UPDATE 1", "second", "third", "fourth"]);
});

test("rejects the awaited child promise when an output health marker fails", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const running = spawnPlaywright({
    binary: "/fixture/playwright",
    arguments_: [],
    cwd: "/fixture",
    environment: {},
    spawnChild: () => child,
    onOutput: () => {
      throw new Error("passive viewer topology became unhealthy");
    },
  });

  child.emit("exit", 0);
  child.stdout.emit("data", Buffer.from("PASSIVE_VIEWER_UPDATE 1\n"));
  child.emit("close", 0);

  await assert.rejects(running, /passive viewer topology became unhealthy/);
});

test("closes the topology when the Playwright child cannot spawn", async () => {
  const child = new EventEmitter();
  let closed = false;
  const topology = {
    baseUrl: "https://gateway.example.test",
    tls: { key: "key", cert: "cert" },
    close: async () => {
      closed = true;
    },
  };
  const failure = new Error("playwright executable is unavailable");
  const promise = runBrowserAcceptance({
    start: async () => topology,
    requestedPlaywrightArguments: ["--project", "chromium", "--grep", "non-passive"],
    spawnChild: () => child,
  });
  setImmediate(() => child.emit("error", failure));

  await assert.rejects(promise, failure);
  assert.equal(closed, true);
});

test("waits for a successful Playwright child close before closing a drained topology", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let exited = false;
  let closed = false;
  const topology = {
    baseUrl: "https://gateway.example.test",
    tls: { key: "key", cert: "cert" },
    bindingCount: () => 0,
    counters: () => ({ activeStreams: 0 }),
    close: async () => {
      assert.equal(exited, true);
      closed = true;
    },
  };
  const acceptance = runBrowserAcceptance({
    start: async () => topology,
    requestedPlaywrightArguments: ["--project", "chromium", "--grep", "non-passive"],
    spawnChild: () => child,
  });
  setImmediate(() => {
    exited = true;
    child.emit("exit", 0);
    assert.equal(closed, false);
    child.emit("close", 0);
  });

  await acceptance;
  assert.equal(closed, true);
});

test("requires three observed passive snapshots for a non-literal grep selection", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let bindings = 0;
  let activeStreams = 0;
  let closed = false;
  let childStarted;
  const started = new Promise((resolve) => {
    childStarted = resolve;
  });
  const topology = {
    baseUrl: "https://gateway.example.test",
    tls: { key: "key", cert: "cert" },
    bindingCount: () => bindings,
    counters: () => ({ subscribe: 1, activate: 1, activeStreams, updates: 1 }),
    close: async () => {
      closed = true;
    },
  };
  const acceptance = runBrowserAcceptance({
    start: async () => topology,
    requestedPlaywrightArguments: ["--project", "chromium", "--grep", "sequential writer"],
    spawnChild: () => {
      childStarted();
      return child;
    },
  });
  await started;
  await new Promise((resolve) => setImmediate(resolve));
  child.stdout.emit("data", Buffer.from("PASSIVE_VIEWER_PRECONDITION\n"));
  bindings = 1;
  activeStreams = 1;
  child.stdout.emit("data", Buffer.from("PASSIVE_VIEWER_UPDATE 1\n"));
  setImmediate(() => {
    bindings = 0;
    activeStreams = 0;
    child.emit("exit", 0);
    child.emit("close", 0);
  });

  await assert.rejects(acceptance, /expected exactly three passive viewer snapshots/);
  assert.equal(closed, true);
});

test("preserves a late output failure when forced-disconnect settlement and close cleanup run", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let bindings = 1;
  let activeStreams = 1;
  let closed = false;
  const order = [];
  let childStarted;
  let settlementStarted;
  const started = new Promise((resolve) => {
    childStarted = resolve;
  });
  const settling = new Promise((resolve) => {
    settlementStarted = resolve;
  });
  const topology = {
    baseUrl: "https://gateway.example.test",
    tls: { key: "key", cert: "cert" },
    bindingCount: () => {
      order.push("settlement");
      settlementStarted();
      return bindings;
    },
    counters: () => ({ subscribe: 0, activate: 0, activeStreams, updates: 0 }),
    close: async () => {
      assert.equal(bindings, 0, "topology closes after settlement drains bindings");
      assert.equal(activeStreams, 0, "topology closes after settlement drains streams");
      closed = true;
      order.push("close");
      throw new Error("topology close failed");
    },
  };
  const acceptance = runBrowserAcceptance({
    start: async () => topology,
    requestedPlaywrightArguments: ["--project", "chromium", "--grep", "disconnect"],
    spawnChild: () => {
      childStarted();
      return child;
    },
  });

  await started;
  await new Promise((resolve) => setImmediate(resolve));
  child.stdout.emit("data", Buffer.from("FORCED_VIEWER_DISCONNECT\n"));
  await settling;
  child.emit("exit", 0);
  child.stdout.emit("data", Buffer.from("PASSIVE_VIEWER_UPDATE 1\n"));
  child.emit("close", 0);
  const rejection = assert.rejects(acceptance, /passive viewer topology became unhealthy/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  bindings = 0;
  activeStreams = 0;

  await rejection;
  assert.equal(closed, true);
  assert.ok(order.indexOf("settlement") < order.indexOf("close"));
});

test("records healthy Gateway bindings and native streams after each ordered passive-viewer update", () => {
  const counters = { subscribe: 1, activate: 1, activeStreams: 1, updates: 0 };
  const topology = {
    bindingCount: () => 1,
    counters: () => ({ ...counters }),
  };
  const snapshots = [];

  for (const update of [1, 2, 3]) {
    counters.updates = update;
    recordPassiveViewerProgress(`PASSIVE_VIEWER_UPDATE ${update}`, topology, snapshots);
  }

  assert.deepEqual(snapshots, [
    { update: 1, bindings: 1, activeStreams: 1, updates: 1 },
    { update: 2, bindings: 1, activeStreams: 1, updates: 2 },
    { update: 3, bindings: 1, activeStreams: 1, updates: 3 },
  ]);
});

test("rejects a passive viewer that starts with a leaked binding or native stream", () => {
  const topology = {
    bindingCount: () => 1,
    counters: () => ({ activeStreams: 1 }),
  };

  assert.throws(
    () => recordPassiveViewerPrecondition("PASSIVE_VIEWER_PRECONDITION", topology),
    /passive viewer started with retained topology state/,
  );
});

test("rejects a passive-viewer marker when the Gateway stream is no longer healthy", () => {
  const topology = {
    bindingCount: () => 1,
    counters: () => ({ subscribe: 1, activate: 1, activeStreams: 0, updates: 1 }),
  };

  assert.throws(
    () => recordPassiveViewerProgress("PASSIVE_VIEWER_UPDATE 1", topology, []),
    /passive viewer topology became unhealthy/,
  );
});

test("waits for a forced viewer disconnect to release bindings and native streams", async () => {
  let probes = 0;
  const topology = {
    bindingCount: () => (probes++ < 2 ? 1 : 0),
    counters: () => ({ activeStreams: probes < 3 ? 1 : 0 }),
  };

  await settleTopology(topology, { timeoutMilliseconds: 100, delayMilliseconds: 0 });
  assert.ok(probes >= 3);
});
