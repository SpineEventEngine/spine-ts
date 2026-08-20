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

/**
 * Shows the standalone GKE Gateway: it discovers ready Node Coordinators through
 * Kubernetes DNS and owns browser-facing concerns, not application replicas.
 */

import { GkeNodeDiscovery } from "@spine-event-engine/deployment-gke";
import { Server, type BrowserServerOptions } from "@spine-event-engine/server";

import { DeploymentSettings, type DeploymentEnvironment } from "./deployment-settings.js";

type GatewayBrowserOptions = BrowserServerOptions extends infer Options
  ? Options extends BrowserServerOptions
    ? Omit<Options, "host" | "port" | "discovery">
    : never
  : never;

/**
 * Supplies application-owned browser collaborators for one Gateway process.
 */
export interface GatewayOptions {
  // prettier-ignore

  /**
   * Configures browser admission, authorization, context, registry, and bindings.
   * Authenticated mode supplies sessions and may name durable bindings. Public mode
   * supplies `publicAccess: true`; the framework owns its process-local bindings.
   */
  readonly browser: GatewayBrowserOptions;
}

/**
 * Starts one GKE-reachable standalone Gateway.
 */
export const GatewayEntrypoint = Object.freeze({
  // prettier-ignore

  /**
   * Starts the Gateway with injected process settings.
   *
   * @param options Supplies application-owned browser collaborators.
   * @param environment Provides injected deployment settings.
   * @returns Completes after the signal-managed Gateway starts.
   */
  async run(
    options: GatewayOptions,
    environment: DeploymentEnvironment = process.env,
  ): Promise<void> {
    const discovery = new GkeNodeDiscovery({
      serviceName: DeploymentSettings.serviceName(environment),
      port: DeploymentSettings.port(environment, "BACKEND_DISCOVERY_PORT"),
    });
    const server = Server.atPort(DeploymentSettings.port(environment, "PORT"), {
      host: "0.0.0.0",
      browser: {
        ...options.browser,
        discovery,
      },
    });
    await server.run();
  },
});
