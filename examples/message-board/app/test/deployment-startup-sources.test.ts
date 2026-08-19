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

import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

const sourceRoot = join(process.cwd(), "examples/message-board/app/src");

describe("MessageBoard deployment entrypoints", () => {
  it("provides explicit combined and application-only startup sources", () => {
    expect(existsSync(join(sourceRoot, "application-server.ts"))).toBe(true);
    expect(existsSync(join(sourceRoot, "combined-server.ts"))).toBe(true);
  });

  it("splits multi-process coordination from complete-replica assembly without the retired signal transport", () => {
    const managed = join(sourceRoot, "multi-process-app.ts");
    const coordinator = join(sourceRoot, "multi-process-coordinator.ts");
    const replica = join(sourceRoot, "multi-process-replica.ts");
    expect(existsSync(managed)).toBe(true);
    expect(existsSync(coordinator)).toBe(true);
    expect(existsSync(replica)).toBe(true);
    const source = readFileSync(managed, "utf8");
    const coordinatorSource = readFileSync(coordinator, "utf8");
    const replicaSource = readFileSync(replica, "utf8");
    const deployment = readFileSync(join(sourceRoot, "deployment-config.ts"), "utf8");

    expect(source).toContain('import("./multi-process-coordinator.js")');
    expect(source).toContain('import("./multi-process-replica.js")');
    expect(coordinatorSource).toContain("ManagedServerApplication.run");
    expect(coordinatorSource).toContain("processCount: config.processCount");
    expect(coordinatorSource).toContain('moduleUrl: new URL("./multi-process-app.js", import.meta.url).href');
    expect(replicaSource).toContain("UniformAcrossAllShards.forNumber(config.deliveryShardCount)");
    expect(replicaSource).toContain("new InMemorySubscriptionRegistry()");
    expect(replicaSource).toContain("MessageBoardDeployment.configureManagedServer");
    expect(deployment).toContain('"PROCESS_COUNT"');
    expect(deployment).toContain('"DELIVERY_SHARD_COUNT"');
    expect(deployment).not.toContain('"SPINE_IPC_DIRECTORY"');
  });

  it("configures both browser modes with one named durable binding assembly", () => {
    const gateway = readFileSync(join(sourceRoot, "gateway-server.ts"), "utf8");
    const combined = readFileSync(join(sourceRoot, "combined-server.ts"), "utf8");
    const deployment = readFileSync(join(sourceRoot, "deployment-config.ts"), "utf8");
    expect(deployment).toContain("new DurableSubscriptionBindings");
    expect(deployment).toContain("storageFactory,");
    expect(gateway).toContain("MessageBoardDeployment.bindings(config, storage)");
    expect(combined).toContain("bindings: MessageBoardDeployment.bindings(config, storage)");
    expect(gateway).toContain("bindings,");
    expect(deployment).toContain('"SUBSCRIPTION_REGISTRY_NAMESPACE"');
  });

  it("configures production storage and transport before resolving a server", () => {
    const deployment = readFileSync(join(sourceRoot, "deployment-config.ts"), "utf8");
    for (const entrypoint of ["application-server.ts", "combined-server.ts"]) {
      const source = readFileSync(join(sourceRoot, entrypoint), "utf8");
      expect(source).toContain(
        "MessageBoardDeployment.configureServer(config, client, process.env, logger)",
      );
      expect(source).toContain("MessageBoardDeployment.logger(");
    }
    expect(deployment).toContain("ServerEnvironment.when(EnvironmentType.Production)");
    expect(deployment).toContain("RemoteDelivery.connectTo");
    expect(deployment).not.toContain('"SPINE_IPC_DIRECTORY"');
  });

  it("connects production MessageBoard processes to the configured delivery server", () => {
    const deployment = readFileSync(join(sourceRoot, "deployment-config.ts"), "utf8");

    expect(deployment).toContain("RemoteDelivery.connectTo");
    expect(deployment).toContain('"DELIVERY_SERVER_URL"');
    expect(deployment).not.toContain("DeliveryQuarantine");
  });

  it("executes application and combined startup entries with caller-owned Datastore clients", async () => {
    const calls = startupMocks();

    await import("../src/application-server.js");
    expect(calls.datastore).toHaveBeenCalledWith({ projectId: "project" });
    expect(calls.createLogger).toHaveBeenCalledWith("project", process.env);
    expect(calls.storage).toHaveBeenCalledWith(calls.client);
    expect(calls.configureServer).toHaveBeenCalledWith(
      calls.applicationConfig,
      calls.client,
      process.env,
      calls.logger,
    );
    expect(calls.runApplication).toHaveBeenCalledWith(calls.applicationConfig, calls.storageResult);

    vi.resetModules();
    await import("../src/combined-server.js");
    expect(calls.datastore).toHaveBeenCalledWith({ projectId: "project" });
    expect(calls.storage).toHaveBeenCalledWith(calls.client);
    expect(calls.configureServer).toHaveBeenCalledWith(
      calls.combinedConfig,
      calls.client,
      process.env,
      calls.logger,
    );
    expect(calls.runCombined).toHaveBeenCalledWith(
      expect.objectContaining({ bindings: calls.bindings }),
      calls.storageResult,
    );
  });

  it("executes gateway startup with configured browser bindings", async () => {
    const calls = startupMocks();

    await import("../src/gateway-server.js");

    expect(calls.datastore).toHaveBeenCalledWith({ projectId: "project" });
    expect(calls.storage).toHaveBeenCalledWith(calls.client);
    expect(calls.configureGatewayServer).toHaveBeenCalledWith(
      calls.gatewayConfig,
      calls.storageResult,
      calls.logger,
    );

    expect(calls.serverAtPort).toHaveBeenCalledWith(
      calls.gatewayConfig.port,
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        browser: expect.objectContaining({ bindings: calls.bindings }),
      }) as object,
    );
  });

  it("executes gateway startup with GKE discovery when configured", async () => {
    const calls = startupMocks();
    calls.gatewayConfig.discovery = { namespace: "boards" };

    await import("../src/gateway-server.js");

    expect(calls.serverAtPort).toHaveBeenCalledOnce();
    expect(calls.gkeNodeDiscovery).toHaveBeenCalledWith({
      namespace: "boards",
      logger: calls.logger,
    });
  });
});

function startupMocks() {
  vi.resetModules();
  const storage = {};
  const bindings = {};
  const applicationConfig = { projectId: "project", port: 0 };
  const combinedConfig = { projectId: "project", port: 0 };
  const gatewayConfig: {
    projectId: string;
    port: number;
    host: string;
    webOrigin: string;
    discovery?: { namespace: string };
  } = { projectId: "project", port: 0, host: "127.0.0.1", webOrigin: "http://web" };
  const runApplication = vi.fn().mockResolvedValue({ baseUrl: "http://application" });
  const runCombined = vi.fn().mockResolvedValue({ baseUrl: "http://combined" });
  const serverAtPort = vi
    .fn()
    .mockReturnValue({ run: vi.fn().mockResolvedValue({ baseUrl: "http://gateway" }) });

  const client = {};
  const datastore = vi.fn(function Datastore() {
    return client;
  });
  const storageFactory = vi.fn(() => storage);
  const configureServer = vi.fn(() => undefined);
  const configureGatewayServer = vi.fn(() => undefined);
  const logger = {};
  const googleLog = {};
  const createLogger = vi.fn(() => logger);
  const loggingLog = vi.fn(() => googleLog);
  const logging = vi.fn(function Logging() {
    return { log: loggingLog };
  });
  const gkeNodeDiscovery = vi.fn(function GkeNodeDiscovery(options: unknown) {
    void options;
  });
  vi.doMock("@google-cloud/datastore", () => ({ Datastore: datastore }));
  vi.doMock("@google-cloud/logging", () => ({ Logging: logging }));
  vi.doMock("../src/deployment-config.js", () => ({
    MessageBoardDeployment: {
      application: () => applicationConfig,
      combined: () => combinedConfig,
      gateway: () => gatewayConfig,
      configureServer,
      configureGatewayServer,
      logger: createLogger,
      storage: storageFactory,
      bindings: () => bindings,
    },
  }));
  vi.doMock("../src/index.js", () => ({
    MessageBoardApplication: class {
      runApplication = runApplication;
      runCombined = runCombined;
    },
  }));
  vi.doMock("@spine-event-engine/server", () => ({ Server: { atPort: serverAtPort } }));
  // These constructable boundary doubles have no behavior beyond import-time startup.
  /* eslint-disable @typescript-eslint/no-extraneous-class, @typescript-eslint/no-empty-function */
  vi.doMock("@spine-event-engine/deployment-gke", () => ({ GkeNodeDiscovery: gkeNodeDiscovery }));
  vi.doMock("../src/board-access.js", () => ({
    BoardAccessPolicy: class {
      authorize() {}
    },
    BoardContextResolver: class {},
  }));
  vi.doMock("../src/model-registry.js", () => ({ typeRegistry: {} }));
  /* eslint-enable @typescript-eslint/no-extraneous-class, @typescript-eslint/no-empty-function */

  return {
    applicationConfig,
    bindings,
    client,
    combinedConfig,
    configureServer,
    configureGatewayServer,
    createLogger,
    datastore,
    gatewayConfig,
    gkeNodeDiscovery,
    googleLog,
    logger,
    logging,
    loggingLog,
    runApplication,
    runCombined,
    serverAtPort,
    storage: storageFactory,
    storageResult: storage,
  };
}
