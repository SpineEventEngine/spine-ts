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
