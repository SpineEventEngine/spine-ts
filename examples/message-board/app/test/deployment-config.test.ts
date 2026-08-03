import { resetServerEnvironmentForTest } from "@spine-event-engine/server/testing";
import { afterEach, describe, expect, it } from "vitest";

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

afterEach(async () => {
  await resetServerEnvironmentForTest();
});

describe("MessageBoard deployment configuration", () => {
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
      backendUrl: "http://application:8081",
    });
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
      MessageBoardDeployment.configureServer(config, {
        ...completeEnvironment,
        NODE_ENV: "development",
      }),
    ).toBeUndefined();
  });

  it("configures production storage and transport as environment-owned facilities", () => {
    const config = MessageBoardDeployment.application(completeEnvironment);
    const storage = MessageBoardDeployment.configureServer(config, {
      ...completeEnvironment,
      NODE_ENV: "production",
      SPINE_IPC_DIRECTORY: "/tmp/spine-message-board-config-test",
    });

    expect(storage?.isOpen()).toBe(true);
  });

  it.each([
    [undefined, "Missing required configuration: DELIVERY_SERVER_URL."],
    ["ftp://delivery:8484", "Invalid required configuration: DELIVERY_SERVER_URL."],
  ])("rejects invalid production delivery configuration %s", (deliveryUrl, expected) => {
    const config = MessageBoardDeployment.application(completeEnvironment);

    expect(() =>
      MessageBoardDeployment.configureServer(config, {
        ...completeEnvironment,
        NODE_ENV: "production",
        SPINE_IPC_DIRECTORY: "/tmp/spine-message-board-config-test",
        DELIVERY_SERVER_URL: deliveryUrl,
      }),
    ).toThrow(expected);
  });

  it("assembles a closeable durable registry over application-selected storage", async () => {
    const config = MessageBoardDeployment.combined(completeEnvironment);
    const storage = MessageBoardDeployment.storage(config);
    const bindings = MessageBoardDeployment.bindings(config, storage);

    expect(bindings.durable).toBe(true);
    expect(bindings.namespace).toBe("message-board-subscriptions");

    await bindings.close();
    storage.close();
  });
});
