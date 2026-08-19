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

import { LeasedNodeRegistry } from "@spine-event-engine/deployment";
import { GceRegistrar } from "@spine-event-engine/deployment-gce";
import {
  ManagedServerApplication,
  type ManagedServerApplicationHandle,
  type ManagedServerApplicationOptions,
  type RunningServer,
} from "@spine-event-engine/server";
import {
  GceDeploymentSettings,
  type DeploymentEnvironment,
  type RegistryStorageResolver,
} from "./deployment-settings.js";

/**
 * Supplies application-owned collaborators for one managed GCE application node.
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

  /**
   * Resolves the application-selected durable registry storage factory.
   */
  readonly registryStorage: RegistryStorageResolver;
}

/**
 * Starts one GCE application node and leases its ready Coordinator endpoint.
 */
export const GceApplicationEntrypoint = Object.freeze({
  // prettier-ignore

  /**
   * Starts the Coordinator, then publishes it only after all initial children are ready.
   *
   * @param options Supplies application assembly and registry configuration.
   * @param environment Provides injected deployment settings.
   * @returns A handle that withdraws the Coordinator before stopping managed children.
   */
  async run(
    options: ApplicationOptions,
    environment: DeploymentEnvironment = process.env,
  ): Promise<ManagedServerApplicationHandle> {
    const port = GceDeploymentSettings.port(environment, "PORT");
    const deliveryShardCount = GceDeploymentSettings.deliveryShardCount(environment);
    const child = process.env.SPINE_MANAGED_SERVER_CHILD === "true";
    const registry = child
      ? undefined
      : new LeasedNodeRegistry({
          factory: options.registryStorage.storageFactoryFor(
            GceDeploymentSettings.registryStorageReference(environment),
          ),
          namespace: GceDeploymentSettings.registryNamespace(environment),
        });
    const registrar = registry === undefined ? undefined : new GceRegistrar({ registry, port });
    let managed: ManagedServerApplicationHandle | undefined;
    let application: ManagedServerApplicationHandle | undefined;
    try {
      managed = await ManagedServerApplication.start({
        processCount: GceDeploymentSettings.processCount(environment),
        host: "0.0.0.0",
        port,
        moduleUrl: options.moduleUrl,
        createServer: async ({ host, port: childPort }) =>
          await options.createServer({ host, port: childPort, deliveryShardCount }),
        ...(options.synchronize === undefined ? {} : { synchronize: options.synchronize }),
        ...(options.restart === undefined ? {} : { restart: options.restart }),
      });
      if (registrar === undefined || registry === undefined) return managed;
      application = GceApplicationEntrypointValues.handle(managed, registrar, registry);
      await registrar.start();
    } catch (error) {
      await GceApplicationEntrypointValues.closeAfterStartFailure(
        managed,
        registrar,
        registry,
        error,
        application,
      );
    }
    if (application === undefined) throw new Error("GCE managed application did not start.");
    return application;
  },
});

const GceApplicationEntrypointValues = Object.freeze({
  async closeAfterStartFailure(
    managed: ManagedServerApplicationHandle | undefined,
    registrar: GceRegistrar | undefined,
    registry: LeasedNodeRegistry | undefined,
    error: unknown,
    application: ManagedServerApplicationHandle | undefined,
  ): Promise<never> {
    const failures = [error];
    if (application !== undefined) {
      try {
        await application.close();
      } catch (cleanup) {
        if (cleanup instanceof AggregateError)
          for (const cleanupError of cleanup.errors) failures.push(cleanupError);
        else failures.push(cleanup);
      }
      if (failures.length === 1) throw error;
      throw new AggregateError(failures, "GCE managed application startup and cleanup failed.");
    }
    for (const close of [() => registrar?.close(), () => managed?.close(), () => registry?.close()])
      try {
        await close();
      } catch (cleanup) {
        failures.push(cleanup);
      }
    if (failures.length === 1) throw error;
    throw new AggregateError(failures, "GCE managed application startup and cleanup failed.");
  },

  handle(
    managed: ManagedServerApplicationHandle | undefined,
    registrar: GceRegistrar | undefined,
    registry: LeasedNodeRegistry | undefined,
  ): ManagedServerApplicationHandle {
    if (managed === undefined) throw new Error("GCE managed application did not start.");
    if (registrar === undefined || registry === undefined) return managed;
    let closing: Promise<void> | undefined;
    const onSignal = () => {
      void close().catch(() => undefined);
    };
    const close = (): Promise<void> => {
      if (closing !== undefined) return closing;
      closing = GceApplicationEntrypointValues.close(managed, registrar, registry).finally(() => {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
      });
      return closing;
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    return {
      get ready() {
        return managed.ready;
      },
      close(): Promise<void> {
        return close();
      },
    };
  },

  async close(
    managed: ManagedServerApplicationHandle,
    registrar: GceRegistrar,
    registry: LeasedNodeRegistry,
  ): Promise<void> {
    const failures: unknown[] = [];
    for (const close of [() => registrar.close(), () => managed.close(), () => registry.close()]) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, "GCE managed application shutdown failed.");
  },

});
