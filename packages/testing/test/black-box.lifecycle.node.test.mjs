/* global URL */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { BlackBoxTestAccess } from "../dist/black-box/internal-test-access.js";

test("close drains subscriptions, then client, then server, even when each phase fails", async () => {
  const calls = [];
  const subscriptionFailure = new Error("subscription");
  const clientFailure = new Error("client");
  const serverFailure = new Error("server");
  const blackBox = BlackBoxTestAccess.create({
    client: {
      close: async () => {
        calls.push("client");
        throw clientFailure;
      },
    },
    server: {
      close: async () => {
        calls.push("server");
        throw serverFailure;
      },
    },
    subscriptions: [
      {
        cancel: async () => {
          calls.push("subscription");
          throw subscriptionFailure;
        },
      },
    ],
  });

  const close = blackBox.close();
  assert.strictEqual(blackBox.close(), close);
  await assert.rejects(close, (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [subscriptionFailure, clientFailure, serverFailure]);
    return true;
  });
  assert.deepEqual(calls, ["subscription", "client", "server"]);
});

test("concurrent close shares its outcome and invokes every resource once", async () => {
  const calls = [];
  const blackBox = BlackBoxTestAccess.create({
    client: {
      close: async () => {
        calls.push("client");
      },
    },
    server: {
      close: async () => {
        calls.push("server");
      },
    },
    subscriptions: [
      {
        cancel: async () => {
          calls.push("subscription");
        },
      },
    ],
  });

  const first = blackBox.close();
  const second = blackBox.close();
  assert.strictEqual(first, second);
  await Promise.all([first, second]);
  assert.deepEqual(calls, ["subscription", "client", "server"]);
});

test("startup failure retains the primary error and appends acquired cleanup failures", async () => {
  const calls = [];
  const primary = new Error("connect");
  const cleanup = new Error("server close");

  await assert.rejects(
    BlackBoxTestAccess.open({
      start: async () => ({
        close: async () => {
          calls.push("server");
          throw cleanup;
        },
      }),
      connect: () => {
        throw primary;
      },
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [primary, cleanup]);
      return true;
    },
  );
  assert.deepEqual(calls, ["server"]);
});

test("root package exports and declarations omit the internal lifecycle seam", async () => {
  const [manifest, declarations] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../dist/index.d.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(manifest, /internal-test-access/);
  assert.doesNotMatch(declarations, /(?:ForTesting|internal-test-access)/);
});

test("BlackBox declarations expose only the public facade", async () => {
  const declarations = await readFile(
    new URL("../dist/black-box/black-box.d.ts", import.meta.url),
    "utf8",
  );
  const blackBox = declarations.match(/export declare class BlackBox \{([\s\S]*?)\n\}/)?.[1];
  assert.notEqual(blackBox, undefined);
  assert.match(blackBox, /\b(?:asGuest|onBehalfOf|eventually|close)\(/);
  assert.doesNotMatch(blackBox, /\b(?:assertOpen|postEvent|track|release)\(/);
});

test("tracked state, event, and observed handles cancel exactly once before BlackBox close", async () => {
  for (const operation of ["cancel", "return", "throw"]) {
    for (const kind of ["state", "event", "observed"]) {
      let cancellations = 0;
      const blackBox = BlackBoxTestAccess.create({
        client: { close: async () => {} },
        server: { close: async () => {} },
      });
      const handle = {
        cancel: async () => {
          cancellations += 1;
        },
        [Symbol.asyncIterator]: () => ({
          next: async () => ({ done: true, value: undefined }),
          return: async () => ({ done: true, value: undefined }),
          throw: async (error) => {
            throw error;
          },
        }),
      };
      const tracked = BlackBoxTestAccess.track(blackBox, handle);
      const iterator = tracked[Symbol.asyncIterator]();
      if (operation === "cancel") await tracked.cancel();
      if (operation === "return") await iterator.return();
      if (operation === "throw") await assert.rejects(iterator.throw(new Error(`${kind} throw`)));
      assert.equal(cancellations, 1, `${kind} ${operation} must cancel once`);
      await blackBox.close();
      assert.equal(cancellations, 1, `${kind} ${operation} must not be re-canceled by close`);
    }
  }
});
