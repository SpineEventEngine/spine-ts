import { Server, type ServerOptions } from "@spine-event-engine/server";

import { DeploymentSettings, type DeploymentEnvironment } from "./deployment-settings.js";

/**
 * Supplies application-owned options for one application-node process.
 */
export interface ApplicationOptions {
  // prettier-ignore

  /**
   * Configures bounded contexts, services, and application resources.
   */
  readonly server: Omit<ServerOptions, "host" | "port" | "browser">;
}

/**
 * Starts one GKE-reachable Spine TS application node.
 */
export const ApplicationEntrypoint = Object.freeze({
  // prettier-ignore

  /**
   * Starts the application with injected process settings.
   *
   * @param options Supplies application-owned server configuration.
   * @param environment Provides injected deployment settings.
   * @returns Completes after the signal-managed server starts.
   */
  async run(
    options: ApplicationOptions,
    environment: DeploymentEnvironment = process.env,
  ): Promise<void> {
    const server = Server.atPort(DeploymentSettings.port(environment, "PORT"), {
      ...options.server,
      host: "0.0.0.0",
    });
    await server.run();
  },
});
