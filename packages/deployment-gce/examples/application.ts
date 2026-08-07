import { LeasedNodeRegistry } from "@spine-event-engine/deployment";
import { GceRegistrar } from "@spine-event-engine/deployment-gce";
import { Server, type ServerOptions } from "@spine-event-engine/server";
import {
  GceDeploymentSettings,
  type DeploymentEnvironment,
  type RegistryStorageResolver,
} from "./deployment-settings.js";

/**
 * Supplies application-owned collaborators for one GCE application-node process.
 */
export interface ApplicationOptions {
  // prettier-ignore

  /**
   * Configures bounded contexts, services, and application resources.
   */
  readonly server: Omit<ServerOptions, "host" | "port" | "browser">;

  /**
   * Resolves the application-selected durable registry storage factory.
   */
  readonly registryStorage: RegistryStorageResolver;
}

/**
 * Starts one GCE application node and registers its ready private listener.
 */
export const GceApplicationEntrypoint = Object.freeze({
  // prettier-ignore

  /**
   * Starts the application after assembling its durable node registry.
   *
   * @param options Supplies application-owned server and storage configuration.
   * @param environment Provides injected deployment settings.
   * @returns Completes after the signal-managed application server starts.
   */
  async run(
    options: ApplicationOptions,
    environment: DeploymentEnvironment = process.env,
  ): Promise<void> {
    const port = GceDeploymentSettings.port(environment, "PORT");
    const registry = new LeasedNodeRegistry({
      factory: options.registryStorage.storageFactoryFor(
        GceDeploymentSettings.registryStorageReference(environment),
      ),
      namespace: GceDeploymentSettings.registryNamespace(environment),
    });
    const registrar = new GceRegistrar({ registry, port });
    const server = Server.atPort(port, { ...options.server, host: "0.0.0.0" });
    server.addResource(registry).addListenerLifecycle(registrar.lifecycle());
    await server.run();
  },
});
