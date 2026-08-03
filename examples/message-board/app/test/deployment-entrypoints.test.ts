import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sourceRoot = join(process.cwd(), "examples/message-board/app/src");

describe("MessageBoard deployment entrypoints", () => {
  it("provides explicit combined and application-only startup sources", () => {
    expect(existsSync(join(sourceRoot, "application-entry.ts"))).toBe(true);
    expect(existsSync(join(sourceRoot, "combined-entry.ts"))).toBe(true);
  });

  it("configures both browser modes with one named durable binding assembly", () => {
    const gateway = readFileSync(join(sourceRoot, "gateway-entry.ts"), "utf8");
    const combined = readFileSync(join(sourceRoot, "combined-entry.ts"), "utf8");
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
    for (const entrypoint of ["application-entry.ts", "combined-entry.ts", "gateway-entry.ts"]) {
      const source = readFileSync(join(sourceRoot, entrypoint), "utf8");
      expect(source).toContain("MessageBoardDeployment.configureServer(config, process.env)");
    }
    expect(deployment).toContain("ServerEnvironment.when(EnvironmentType.Production)");
    expect(deployment).toContain('"SPINE_IPC_DIRECTORY"');
    expect(deployment).toContain("createZeroMqTransport");
  });

  it("connects production MessageBoard processes to the configured delivery server", () => {
    const deployment = readFileSync(join(sourceRoot, "deployment-config.ts"), "utf8");

    expect(deployment).toContain("RemoteDelivery.connectTo");
    expect(deployment).toContain('"DELIVERY_SERVER_URL"');
    expect(deployment).toContain("DeliveryQuarantine");
  });
});
