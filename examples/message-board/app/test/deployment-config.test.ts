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

import { resetServerEnvironmentForTest } from "@spine-event-engine/server/testing";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import type { Datastore } from "@google-cloud/datastore";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageBoardDeployment } from "../src/deployment-config.js";

const completeEnvironment: NodeJS.ProcessEnv = {
  HOST: "127.0.0.1",
  PORT: "8080",
  DATASTORE_PROJECT_ID: "message-board-test",
  BROWSER_ORIGIN: "https://board.example.com",
  SUBSCRIPTION_REGISTRY_NAMESPACE: "message-board-subscriptions",
  BACKEND_URL: "http://application:8081",
  DELIVERY_SERVER_URL: "http://delivery:8484",
};
const client = {} as Datastore;

afterEach(async () => {
  await resetServerEnvironmentForTest();
});

describe("MessageBoard deployment configuration", () => {
  it("requires shared Delivery for a managed replica", () => {
    expect(() =>
      MessageBoardDeployment.configureManagedServer(
        { host: "127.0.0.1", port: 8080, projectId: "message-board-test" },
        client,
        {
          ...completeEnvironment,
          DELIVERY_SERVER_URL: undefined,
        },
      ),
    ).toThrow("DELIVERY_SERVER_URL");
  });
  it("uses console logging in the local Datastore emulator and Cloud Logging elsewhere", () => {
    expect(
      MessageBoardDeployment.logger("message-board-test", {
        DATASTORE_EMULATOR_HOST: "datastore:8081",
      }),
    ).toBeUndefined();
    expect(MessageBoardDeployment.logger("message-board-test", {})).toBeDefined();
  });

  it("composes an application logger with the official Google Cloud transport", () => {
    const entry = vi.fn((_metadata: unknown, data: unknown) => data);
    const write = vi.fn();
    const logger = MessageBoardDeployment.cloudLogger({ entry, write } as never);

    logger.withMetadata({ entityId: "message-1" }).warn("Message delivery was delayed.");

    expect(entry).toHaveBeenCalledOnce();
    const call = entry.mock.calls[0];
    if (call === undefined) throw new Error("Expected one Google Log entry.");
    const metadata = call[0] as { readonly severity?: unknown; readonly timestamp?: unknown };
    expect(metadata.severity).toBe("WARNING");
    expect(metadata.timestamp).toBeInstanceOf(Date);
    expect(call[1]).toEqual({
      entityId: "message-1",
      message: "Message delivery was delayed.",
    });
    expect(write).toHaveBeenCalledWith({
      entityId: "message-1",
      message: "Message delivery was delayed.",
    });
  });

  it("reads application, combined, and gateway settings from one environment", () => {
    expect(MessageBoardDeployment.application(completeEnvironment)).toMatchObject({
      host: "127.0.0.1",
      port: 8080,
      projectId: "message-board-test",
    });
    expect(MessageBoardDeployment.combined(completeEnvironment)).toMatchObject({
      webOrigin: "https://board.example.com",
      subscriptionNamespace: "message-board-subscriptions",
    });
    expect(MessageBoardDeployment.gateway(completeEnvironment)).toMatchObject({
      backendUrls: ["http://application:8081"],
    });
  });

  it("reads independent explicit managed process and Delivery shard counts", () => {
    expect(
      MessageBoardDeployment.managed({
        ...completeEnvironment,
        PROCESS_COUNT: "3",
        DELIVERY_SHARD_COUNT: "5",
      }),
    ).toMatchObject({ processCount: 3, deliveryShardCount: 5 });
  });

  it.each([
    [undefined, "1", "PROCESS_COUNT"],
    ["0", "1", "PROCESS_COUNT"],
    ["1", "1.5", "DELIVERY_SHARD_COUNT"],
  ])(
    "rejects invalid managed count configuration",
    (processCount, deliveryShardCount, expected) => {
      expect(() =>
        MessageBoardDeployment.managed({
          ...completeEnvironment,
          PROCESS_COUNT: processCount,
          DELIVERY_SHARD_COUNT: deliveryShardCount,
        }),
      ).toThrow(expected);
    },
  );

  it("prefers the ordered fixed BACKEND_URLS topology over the legacy backend URL", () => {
    expect(
      MessageBoardDeployment.gateway({
        ...completeEnvironment,
        BACKEND_URLS: "http://application-a:8081,http://application-b:8081",
      }).backendUrls,
    ).toEqual(["http://application-a:8081", "http://application-b:8081"]);
  });

  it("uses GKE discovery instead of a fixed backend list when configured", () => {
    expect(
      MessageBoardDeployment.gateway({
        ...completeEnvironment,
        BACKEND_DISCOVERY_SERVICE: "message-board-application-headless",
        BACKEND_DISCOVERY_PORT: "8080",
      }),
    ).toMatchObject({
      discovery: { serviceName: "message-board-application-headless", port: 8080 },
    });
  });

  it("rejects an empty entry in the ordered backend topology", () => {
    expect(() =>
      MessageBoardDeployment.gateway({
        ...completeEnvironment,
        BACKEND_URLS: "http://application-a:8081,",
      }),
    ).toThrow("Invalid required configuration: BACKEND_URLS.");
  });

  it.each([
    ["HOST", undefined],
    ["DATASTORE_PROJECT_ID", ""],
    ["BROWSER_ORIGIN", undefined],
    ["SUBSCRIPTION_REGISTRY_NAMESPACE", ""],
    ["BACKEND_URL", undefined],
  ])("rejects missing required %s", (name, value) => {
    expect(() => MessageBoardDeployment.gateway({ ...completeEnvironment, [name]: value })).toThrow(
      `Missing required configuration: ${name}.`,
    );
  });

  it.each(["0", "65536", "1.5", "not-a-port"])("rejects invalid port %s", (value) => {
    expect(() =>
      MessageBoardDeployment.application({ ...completeEnvironment, PORT: value }),
    ).toThrow("Invalid required configuration: PORT.");
  });

  it("leaves local server facilities unchanged", () => {
    const config = MessageBoardDeployment.application(completeEnvironment);

    expect(
      MessageBoardDeployment.configureServer(config, client, {
        ...completeEnvironment,
        NODE_ENV: "development",
      }),
    ).toBeUndefined();
  });

  it("configures production storage and transport as environment-owned facilities", () => {
    const config = MessageBoardDeployment.application(completeEnvironment);
    const logger = MessageBoardDeployment.cloudLogger({
      entry: vi.fn((_metadata: unknown, data: unknown) => data),
      write: vi.fn(),
    } as never);
    const storage = MessageBoardDeployment.configureServer(
      config,
      client,
      {
        ...completeEnvironment,
        NODE_ENV: "production",
      },
      logger,
    );

    expect(storage?.isOpen()).toBe(true);
  });

  it.each([
    [undefined, "Missing required configuration: DELIVERY_SERVER_URL."],
    ["ftp://delivery:8484", "Invalid required configuration: DELIVERY_SERVER_URL."],
  ])("rejects invalid production delivery configuration %s", (deliveryUrl, expected) => {
    const config = MessageBoardDeployment.application(completeEnvironment);

    expect(() =>
      MessageBoardDeployment.configureServer(config, client, {
        ...completeEnvironment,
        NODE_ENV: "production",
        DELIVERY_SERVER_URL: deliveryUrl,
      }),
    ).toThrow(expected);
  });

  it("assembles a closeable durable registry over supplied local storage", async () => {
    const config = MessageBoardDeployment.combined(completeEnvironment);
    const storage = new InMemoryStorageFactory();
    const bindings = MessageBoardDeployment.bindings(config, storage);

    expect(bindings.namespace).toBe("message-board-subscriptions");

    await bindings.close();
    storage.close();
  });
});
