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

import { describe, expect, it, vi } from "vitest";
import { spineCoreRegistry } from "@spine-event-engine/core";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import type { ServerEnvironmentSettings } from "../../src/server/server-environment.js";

import {
  Application,
  BoundedContext,
  EnvironmentType,
  Server,
  ServerEnvironment,
} from "../../src/index.js";

function localEnvironment(settings: ServerEnvironmentSettings = {}): ServerEnvironment {
  return ServerEnvironment.newBuilder()
    .under(EnvironmentType.Local, (configuration) => {
      configuration.use(settings);
    })
    .build();
}

describe("ServerEnvironment instances", () => {
  it("validates production facilities and starts an Application under the production profile", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const production = await import("../../src/index.js");
    try {
      expect(production.Environment.instance().type).toBe(production.EnvironmentType.Production);
      expect(() =>
        production.ServerEnvironment.newBuilder()
          .under(production.EnvironmentType.Production, () => undefined)
          .build(),
      ).toThrow("Production ServerEnvironment requires typeRegistry.");

      const environment = production.ServerEnvironment.newBuilder()
        .under(production.EnvironmentType.Production, (configuration) => {
          configuration.use({ typeRegistry: spineCoreRegistry });
        })
        .build();
      expect(environment.environment.type).toBe(production.EnvironmentType.Production);
      const application = await production.Application.newBuilder()
        .setServerEnvironment(environment)
        .add(production.BoundedContext.singleTenant("NoLegacyTransport"))
        .build();
      const running = await production.Server.atPort(0).setApplication(application).start();
      await running.close();
      await application.close();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("resolves each builder once and creates independent environment identities", async () => {
    let resolved = 0;
    const createEnvironment = () =>
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (configuration) => {
          resolved += 1;
          configuration.use({});
        })
        .build();
    const first = createEnvironment();
    const second = createEnvironment();
    expect(first).not.toBe(second);
    expect(first.nodeId).not.toBe(second.nodeId);
    expect(resolved).toBe(2);
    const firstApplication = await Application.newBuilder()
      .setServerEnvironment(first)
      .add(BoundedContext.singleTenant("FirstResolution"))
      .build();
    const secondApplication = await Application.newBuilder()
      .setServerEnvironment(second)
      .add(BoundedContext.singleTenant("SecondResolution"))
      .build();
    expect(resolved).toBe(2);
    await firstApplication.close();
    await secondApplication.close();
  });

  it("keeps configured facilities with their selected Application", async () => {
    const closed: string[] = [];
    const firstFactory = new InMemoryStorageFactory();
    const secondFactory = new InMemoryStorageFactory();
    const closeFirst = firstFactory.close.bind(firstFactory);
    const closeSecond = secondFactory.close.bind(secondFactory);
    vi.spyOn(firstFactory, "close").mockImplementation(async () => {
      closed.push("first");
      await closeFirst();
    });
    vi.spyOn(secondFactory, "close").mockImplementation(async () => {
      closed.push("second");
      await closeSecond();
    });
    const first = localEnvironment({ storageFactory: firstFactory });
    const second = localEnvironment({ storageFactory: secondFactory });
    const firstApplication = await Application.newBuilder()
      .setServerEnvironment(first)
      .add(BoundedContext.singleTenant("First"))
      .build();
    const secondApplication = await Application.newBuilder()
      .setServerEnvironment(second)
      .add(BoundedContext.singleTenant("Second"))
      .build();
    const firstServer = await Server.atPort(0).setApplication(firstApplication).start();
    const secondServer = await Server.atPort(0).setApplication(secondApplication).start();
    try {
      await firstServer.close();
      expect(closed).toEqual([]);
      await firstApplication.close();
      expect(closed).toEqual(["first"]);
      await secondServer.close();
      await secondApplication.close();
      expect(closed).toEqual(["first", "second"]);
    } finally {
      await firstServer.close();
      await secondServer.close();
      await firstApplication.close();
      await secondApplication.close();
    }
  });

  it("allows a new environment while another is closing", async () => {
    const releaseClose = Promise.withResolvers<undefined>();
    const old = localEnvironment({ delivery: { close: () => releaseClose.promise } });
    const closing = old.close();
    const fresh = localEnvironment();
    expect(fresh).not.toBe(old);
    releaseClose.resolve(undefined);
    await closing;
    await fresh.close();
  });

  it("retries failed facility close on the same environment", async () => {
    const failure = new Error("configured delivery close failed");
    let attempts = 0;
    const environment = localEnvironment({
      delivery: {
        close: () => {
          attempts += 1;
          if (attempts === 1) throw failure;
        },
      },
    });
    await expect(environment.close()).rejects.toMatchObject({
      message: "ServerEnvironment close failed.",
      errors: [failure],
    });
    await environment.close();
    expect(attempts).toBe(2);
  });

  it("closes configured facilities in order and leaves each environment independent", async () => {
    const closed: string[] = [];
    const environment = localEnvironment({
      delivery: { close: () => closed.push("delivery") },
      storageFactory: { close: () => closed.push("storage") } as never,
    });
    await environment.close();
    expect(closed).toEqual(["delivery", "storage"]);
    const fresh = localEnvironment();
    expect(fresh).not.toBe(environment);
    await fresh.close();
  });
});
