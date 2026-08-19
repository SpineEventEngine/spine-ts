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

import {
  ManagedServerApplication,
  type ManagedServerApplicationHandle,
  type ManagedServerApplicationOptions,
  type RunningServer,
} from "@spine-event-engine/server";

import { DeploymentSettings, type DeploymentEnvironment } from "./deployment-settings.js";

/**
 * Supplies application-owned options for one managed GKE application node.
 */
export interface ApplicationOptions {
  // prettier-ignore

  /**
   * Identifies the entry module that each managed child executes.
   */
  readonly moduleUrl: string;

  /**
   * Builds one complete application replica. Use `deliveryShardCount` while
   * building every Bounded Context's Delivery strategy.
   */
  readonly createServer: (options: {
    readonly host: string;
    readonly port: number;
    readonly deliveryShardCount: number;
  }) => Promise<RunningServer>;

  /**
   * Completes child-local synchronization before its Coordinator admits it.
   */
  readonly synchronize?: ManagedServerApplicationOptions["synchronize"];

  /**
   * Configures bounded replacement of an unexpectedly exited child.
   */
  readonly restart?: ManagedServerApplicationOptions["restart"];
}

/**
 * Starts one GKE-reachable managed application node. The headless Service
 * reaches this process's Coordinator; its children remain loopback-only.
 */
export const ApplicationEntrypoint = Object.freeze({
  // prettier-ignore

  /**
   * Starts the Coordinator and the configured number of complete application replicas.
   *
   * @param options Supplies application assembly and managed-child configuration.
   * @param environment Provides injected deployment settings.
   * @returns The managed application handle.
   */
  async run(
    options: ApplicationOptions,
    environment: DeploymentEnvironment = process.env,
  ): Promise<ManagedServerApplicationHandle> {
    const deliveryShardCount = DeploymentSettings.deliveryShardCount(environment);
    return await ManagedServerApplication.run({
      processCount: DeploymentSettings.processCount(environment),
      host: "0.0.0.0",
      port: DeploymentSettings.port(environment, "PORT"),
      moduleUrl: options.moduleUrl,
      createServer: async ({ host, port }) =>
        await options.createServer({ host, port, deliveryShardCount }),
      ...(options.synchronize === undefined ? {} : { synchronize: options.synchronize }),
      ...(options.restart === undefined ? {} : { restart: options.restart }),
    });
  },
});
