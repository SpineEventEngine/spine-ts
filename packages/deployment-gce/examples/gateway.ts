import { LeasedNodeRegistry } from "@spine-event-engine/deployment";
import { GceNodeDiscovery } from "@spine-event-engine/deployment-gce";
import { Server, type BrowserServerOptions } from "@spine-event-engine/server";

import {
  GceDeploymentSettings,
  type DeploymentEnvironment,
  type RegistryStorageResolver,
} from "./deployment-settings.js";

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
   * Resolves the application-selected durable registry storage factory.
   */
  readonly registryStorage: RegistryStorageResolver;
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
      factory: options.registryStorage.storageFactoryFor(
        GceDeploymentSettings.registryStorageReference(environment),
      ),
      namespace: GceDeploymentSettings.registryNamespace(environment),
    });
    const discovery = new GceNodeDiscovery({ registry });
    const server = Server.atPort(GceDeploymentSettings.port(environment, "PORT"), {
      host: "0.0.0.0",
      browser: { ...options.browser, discovery },
    });
    await server.run();
  },
});
