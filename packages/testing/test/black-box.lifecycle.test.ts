/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { describe, expect, it } from "vitest";

import { BlackBoxTestAccess } from "../src/black-box/black-box.js";

describe("BlackBox lifecycle seams", () => {
  it("aggregates subscription, client, and server cleanup failures", async () => {
    const subscriptionFailure = new Error("subscription");
    const clientFailure = new Error("client");
    const serverFailure = new Error("server");
    const blackBox = BlackBoxTestAccess.create({
      client: { close: async () => Promise.reject(clientFailure) },
      server: { close: async () => Promise.reject(serverFailure) },
      subscriptions: [{ cancel: async () => Promise.reject(subscriptionFailure) }],
    });

    const failure = await blackBox.close().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      subscriptionFailure,
      clientFailure,
      serverFailure,
    ]);
  });

  it("cleans an acquired server when connection startup fails", async () => {
    const primary = new Error("connect");
    const cleanup = new Error("server cleanup");

    const failure = await BlackBoxTestAccess.open({
      start: () => Promise.resolve({ close: () => Promise.reject(cleanup) }),
      connect: () => {
        throw primary;
      },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([primary, cleanup]);
  });

  it("releases a returned tracked handle and rejects unsupported activation", async () => {
    let cancellations = 0;
    const blackBox = BlackBoxTestAccess.create({
      client: { close: () => Promise.resolve() },
      server: { close: () => Promise.resolve() },
    });
    const tracked = BlackBoxTestAccess.track(blackBox, {
      cancel: () => {
        cancellations++;
        return Promise.resolve();
      },
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ done: true as const, value: undefined }),
        return: () => Promise.resolve({ done: true as const, value: undefined }),
      }),
    });

    const activation = tracked as typeof tracked & { activate(): Promise<void> };
    await expect(activation.activate()).rejects.toThrow("does not support activation");
    await expect(tracked[Symbol.asyncIterator]().return?.()).resolves.toMatchObject({ done: true });
    expect(cancellations).toBe(1);
    await blackBox.close();
    expect(cancellations).toBe(1);
  });
});
