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

import { afterEach, describe, expect, it, vi } from "vitest";
import { spineCoreRegistry } from "@spine-event-engine/core";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";

import { Environment, EnvironmentType, Server, ServerEnvironment } from "../../src/index.js";
import { resetServerEnvironmentForTest } from "../../src/testing/index.js";

afterEach(async () => {
  await resetServerEnvironmentForTest();
});

describe("ServerEnvironment singleton", () => {
  it("validates and resolves production facilities selected before first resolution", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const production = await import("../../src/index.js");
    const testing = await import("../../src/testing/index.js");

    try {
      expect(production.Environment.instance().type).toBe(production.EnvironmentType.Production);
      expect(() => production.ServerEnvironment.instance()).toThrow(
        "Production ServerEnvironment requires storageFactory.",
      );

      const storageFactory = new InMemoryStorageFactory();
      production.ServerEnvironment.when(production.EnvironmentType.Production).use({
        storageFactory,
      });
      production.ServerEnvironment.when(production.EnvironmentType.Production).use({
        storageFactory,
        typeRegistry: spineCoreRegistry,
      });
      const environment = production.ServerEnvironment.instance();

      expect(environment.environment.type).toBe(production.EnvironmentType.Production);
      expect(environment.storageFactory).toBe(storageFactory);

      const running = await production.Server.atPort(0)
        .add(production.BoundedContext.singleTenant("NoLegacyTransport").build())
        .start();
      await running.close();
    } finally {
      await testing.resetServerEnvironmentForTest();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("resolves concurrent same-turn access once and shares its stable node identity", async () => {
    let resolved = 0;
    ServerEnvironment.when(EnvironmentType.Local).use(() => {
      resolved += 1;
      return {};
    });

    const [first, second, third] = await Promise.all([
      Promise.resolve().then(() => ServerEnvironment.instance()),
      Promise.resolve().then(() => ServerEnvironment.instance()),
      Promise.resolve().then(() => ServerEnvironment.instance()),
    ]);

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(first.nodeId).toBe(second.nodeId);
    expect(resolved).toBe(1);
    expect(Environment.instance()).toBe(Environment.instance());
  });

  it("gives sibling server builders the same singleton facilities", () => {
    const closed: string[] = [];
    ServerEnvironment.when(EnvironmentType.Local).use({
      storageFactory: { close: () => closed.push("storage") } as never,
    });
    const first = Server.atPort(0);
    const second = Server.atPort(0);

    expect(first).toBeInstanceOf(Server);
    expect(second).toBeInstanceOf(Server);
    expect(ServerEnvironment.instance().storageFactory).toBe(
      ServerEnvironment.instance().storageFactory,
    );
    expect(closed).toEqual([]);
  });

  it("rejects resolution while deterministic disposal is in progress", async () => {
    const releaseClose = Promise.withResolvers<undefined>();
    ServerEnvironment.when(EnvironmentType.Local).use({
      delivery: { close: () => releaseClose.promise },
    });
    const old = ServerEnvironment.instance();

    const resetting = resetServerEnvironmentForTest();
    expect(() => ServerEnvironment.instance()).toThrow("ServerEnvironment reset is in progress.");
    expect(() => {
      ServerEnvironment.when(EnvironmentType.Local).use({});
    }).toThrow("ServerEnvironment reset is in progress.");
    releaseClose.resolve(undefined);
    await resetting;

    ServerEnvironment.when(EnvironmentType.Local).use({});
    expect(ServerEnvironment.instance()).not.toBe(old);
  });

  it("retains failed disposal settings and retries them before accepting a fresh graph", async () => {
    const failure = new Error("configured delivery close failed");
    let closeAttempts = 0;
    const oldDelivery = {
      close: () => {
        closeAttempts += 1;
        if (closeAttempts === 1) {
          return Promise.reject(failure);
        }
        return undefined;
      },
    };
    ServerEnvironment.when(EnvironmentType.Local).use({ delivery: oldDelivery });
    const old = ServerEnvironment.instance();

    await expect(resetServerEnvironmentForTest()).rejects.toMatchObject({
      message: "ServerEnvironment close failed.",
    });

    expect(ServerEnvironment.instance()).toBe(old);
    expect(() => {
      ServerEnvironment.when(EnvironmentType.Local).use({});
    }).toThrow("ServerEnvironment is already resolved and cannot be reconfigured.");

    await expect(resetServerEnvironmentForTest()).resolves.toBeUndefined();

    const freshDelivery = { close: () => undefined };
    ServerEnvironment.when(EnvironmentType.Local).use({ delivery: freshDelivery });
    const fresh = ServerEnvironment.instance();

    expect(fresh).not.toBe(old);
    expect(fresh.delivery).toBe(freshDelivery);
    expect(closeAttempts).toBe(2);
  });

  it("retains an active server graph until that server detaches and reset retries", async () => {
    const old = ServerEnvironment.instance();
    const running = await Server.atPort(0).start();

    await expect(resetServerEnvironmentForTest()).rejects.toThrow(
      "ServerEnvironment cannot close while it is in use.",
    );

    expect(ServerEnvironment.instance()).toBe(old);
    expect(() => {
      ServerEnvironment.when(EnvironmentType.Local).use({});
    }).toThrow("ServerEnvironment is already resolved and cannot be reconfigured.");

    await running.close();
    await expect(resetServerEnvironmentForTest()).resolves.toBeUndefined();

    const fresh = ServerEnvironment.instance();
    expect(fresh).not.toBe(old);
    expect(fresh.environment.type).toBe(EnvironmentType.Local);
  });

  it("rejects reconfiguration after resolution and closes every configured facility on reset", async () => {
    const closed: string[] = [];
    ServerEnvironment.when(EnvironmentType.Local).use({
      delivery: {
        close: () => {
          closed.push("delivery");
        },
      },
      tracerFactory: {
        close: () => {
          closed.push("tracer");
        },
      },
      storageFactory: {
        close: () => {
          closed.push("storage");
        },
      } as never,
    });
    ServerEnvironment.instance();

    expect(() => {
      ServerEnvironment.when(EnvironmentType.Local).use({});
    }).toThrow("ServerEnvironment is already resolved and cannot be reconfigured.");
    await resetServerEnvironmentForTest();

    expect(closed).toEqual(["delivery", "tracer", "storage"]);
  });
});
