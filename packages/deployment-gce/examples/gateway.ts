import { LeasedNodeRegistry, ScheduledNodeDiscovery } from "@spine-event-engine/deployment";
import { GceRegistryReader } from "@spine-event-engine/deployment-gce";
import { Server, type BrowserServerOptions } from "@spine-event-engine/server";
import type { StorageFactory } from "@spine-event-engine/storage";

import { GceDeploymentSettings, type DeploymentEnvironment } from "./deployment-settings.js";

/**
 * Supplies application-owned collaborators for one standalone Gateway process.
 */
export interface GatewayOptions {
  // prettier-ignore

  /**
   * Configures browser authentication, authorization, context, registry, and bindings.
   */
  readonly browser: Omit<BrowserServerOptions, "host" | "port" | "discovery">;

  /**
   * Provides the application-selected durable storage factory.
   */
  readonly storageFactory: StorageFactory;
}

/**
 * Starts one GCE Gateway that refreshes complete membership every ten seconds.
 */
export const GceGatewayEntrypoint = Object.freeze({
  // prettier-ignore

  /**
   * Starts the Gateway after assembling registry-backed application discovery.
   *
   * @param options Supplies browser collaborators and application-selected storage.
   * @param environment Provides injected deployment settings.
   * @returns Completes after the signal-managed Gateway starts.
   */
  async run(
    options: GatewayOptions,
    environment: DeploymentEnvironment = process.env,
  ): Promise<void> {
    const registry = new LeasedNodeRegistry({
      factory: options.storageFactory,
      namespace: GceDeploymentSettings.registryNamespace(environment),
    });
    const discovery = new ScheduledNodeDiscovery({
      reader: new GceRegistryReader(registry),
    });
    const server = Server.atPort(GceDeploymentSettings.port(environment, "PORT"), {
      host: "0.0.0.0",
      browser: { ...options.browser, discovery },
    });
    await server.run();
  },
});
