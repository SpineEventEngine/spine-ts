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
 * Validates the environment contract shared by the GKE application and Gateway
 * examples. Kubernetes supplies these values; the framework does not infer them.
 */
export type DeploymentEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Reads and validates settings shared by application and Gateway entrypoints.
 */
export const DeploymentSettings = Object.freeze({
  // prettier-ignore

  /**
   * Reads one listener port.
   *
   * @param environment Provides injected process settings.
   * @param name Names the required port setting.
   * @returns The validated TCP port.
   */
  port(environment: DeploymentEnvironment, name: "PORT" | "BACKEND_DISCOVERY_PORT"): number {
    const value = environment[name];
    const port = Number(value);
    if (typeof value !== "string" || !Number.isInteger(port) || port < 1 || port > 65_535)
      throw new Error(`${name} must be an integer from 1 through 65535.`);
    return port;
  },

  /**
   * Reads the Kubernetes Service used to discover application nodes.
   *
   * @param environment Provides injected process settings.
   * @returns The non-empty Service name.
   */
  serviceName(environment: DeploymentEnvironment): string {
    const value = environment.BACKEND_DISCOVERY_SERVICE?.trim();
    if (value === undefined || value.length === 0)
      throw new Error("BACKEND_DISCOVERY_SERVICE must not be blank.");
    return value;
  },

  /**
   * Reads the deployer-selected number of complete application replicas in this Node process.
   *
   * @param environment Provides injected process settings.
   * @returns The positive managed child count.
   */
  processCount(environment: DeploymentEnvironment): number {
    return DeploymentSettings.count(environment, "APPLICATION_PROCESS_COUNT");
  },

  /**
   * Reads the application-selected Delivery shard count passed to server assembly.
   *
   * @param environment Provides injected process settings.
   * @returns The positive Delivery shard count.
   */
  deliveryShardCount(environment: DeploymentEnvironment): number {
    return DeploymentSettings.count(environment, "DELIVERY_SHARD_COUNT");
  },

  count(
    environment: DeploymentEnvironment,
    name: "APPLICATION_PROCESS_COUNT" | "DELIVERY_SHARD_COUNT",
  ): number {
    const value = environment[name];
    const count = Number(value);
    if (typeof value !== "string" || !Number.isSafeInteger(count) || count < 1)
      throw new Error(`${name} must be a positive safe integer.`);
    return count;
  },
});
