import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { setImmediate } from "node:timers";

import { runBrowserAcceptance, spawnPlaywright } from "./run.mjs";

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
