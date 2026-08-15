import assert from "node:assert/strict";
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

test("closes the topology when the Playwright child cannot spawn", async () => {
  const child = new EventEmitter();
  let closed = false;
  const topology = {
    baseUrl: "https://gateway.example.test",
    cookie: { setCookie: "cookie", csrf: "csrf" },
    expiredCookie: { setCookie: "expired" },
    cookieB: { setCookie: "cookie-b", csrf: "csrf-b" },
    tls: { key: "key", cert: "cert" },
    close: async () => {
      closed = true;
    },
  };
  const failure = new Error("playwright executable is unavailable");
  const promise = runBrowserAcceptance({
    start: async () => topology,
    requestedPlaywrightArguments: ["--project", "chromium"],
    spawnChild: () => child,
  });
  setImmediate(() => child.emit("error", failure));

  await assert.rejects(promise, failure);
  assert.equal(closed, true);
});

test("waits for a successful Playwright child exit before closing a drained topology", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let exited = false;
  let closed = false;
  const topology = {
    baseUrl: "https://gateway.example.test",
    cookie: { setCookie: "cookie", csrf: "csrf" },
    expiredCookie: { setCookie: "expired" },
    cookieB: { setCookie: "cookie-b", csrf: "csrf-b" },
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
    requestedPlaywrightArguments: ["--project", "chromium"],
    spawnChild: () => child,
  });
  setImmediate(() => {
    exited = true;
    child.emit("exit", 0);
  });

  await acceptance;
  assert.equal(closed, true);
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
