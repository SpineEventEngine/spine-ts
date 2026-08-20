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
 * Shows the standalone GCE Gateway: it discovers leased Node Coordinators and
 * owns browser-facing concerns, but it does not run application replicas.
 */

import { LeasedNodeRegistry } from "@spine-event-engine/deployment";
import { GceNodeDiscovery } from "@spine-event-engine/deployment-gce";
import { Server, type BrowserServerOptions } from "@spine-event-engine/server";

import {
  GceDeploymentSettings,
  type DeploymentEnvironment,
  type RegistryStorageResolver,
} from "./deployment-settings.js";

type GatewayBrowserOptions = BrowserServerOptions extends infer Options
  ? Options extends BrowserServerOptions
    ? Omit<Options, "host" | "port" | "discovery">
    : never
  : never;

/**
 * Supplies application-owned collaborators for one standalone Gateway process.
 */
export interface GatewayOptions {
  // prettier-ignore

  /**
   * Configures browser authentication, authorization, context, registry, and bindings.
   */
  readonly browser: GatewayBrowserOptions;

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
