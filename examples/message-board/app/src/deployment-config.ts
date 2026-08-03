import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import {
  DurableSubscriptionBindings,
  EnvironmentType,
  ServerEnvironment,
} from "@spine-event-engine/server";
import type { StorageFactory } from "@spine-event-engine/storage";
import { ZeroMqConfig, createZeroMqTransport } from "@spine-event-engine/transport/zeromq";
import { randomUUID } from "node:crypto";

import type { BoardServerOptions } from "./index.js";

interface DeploymentConfig extends BoardServerOptions {
  readonly host: string;
  readonly port: number;
  readonly projectId: string;
}

interface CombinedConfig extends DeploymentConfig {
  readonly webOrigin: string;
  readonly subscriptionNamespace: string;
}

interface GatewayConfig extends CombinedConfig {
  readonly backendUrl: string;
}

interface DeploymentContract {
  application(environment: NodeJS.ProcessEnv): DeploymentConfig;
  combined(environment: NodeJS.ProcessEnv): CombinedConfig;
  gateway(environment: NodeJS.ProcessEnv): GatewayConfig;
  storage(config: DeploymentConfig): StorageFactory;
  bindings(config: CombinedConfig, storageFactory: StorageFactory): DurableSubscriptionBindings;
  configureServer(
    config: DeploymentConfig,
    environment: NodeJS.ProcessEnv,
  ): StorageFactory | undefined;
}

/**
 * Reads the finite MessageBoard runtime configuration without exposing values in errors.
 */
export const MessageBoardDeployment: DeploymentContract = Object.freeze({
  application(environment: NodeJS.ProcessEnv): DeploymentConfig {
    return {
      host: required(environment, "HOST"),
      port: port(required(environment, "PORT")),
      projectId: required(environment, "DATASTORE_PROJECT_ID"),
    };
  },

  combined(environment: NodeJS.ProcessEnv): CombinedConfig {
    return {
      ...MessageBoardDeployment.application(environment),
      webOrigin: required(environment, "BROWSER_ORIGIN"),
      subscriptionNamespace: required(environment, "SUBSCRIPTION_REGISTRY_NAMESPACE"),
    };
  },

  gateway(environment: NodeJS.ProcessEnv): GatewayConfig {
    const combined = MessageBoardDeployment.combined(environment);
    return {
      ...combined,
      backendUrl: required(environment, "BACKEND_URL"),
    };
  },

  storage(config: DeploymentConfig): StorageFactory {
    return DatastoreStorageFactory.create({ projectId: config.projectId });
  },

  bindings(config: CombinedConfig, storageFactory: StorageFactory): DurableSubscriptionBindings {
    return new DurableSubscriptionBindings({
      storageFactory,
      namespace: config.subscriptionNamespace,
      nextId: randomUUID,
      dispose: () => Promise.resolve(),
      leaseMs: 60_000,
      cleanupBatchSize: 100,
      recordLimit: 10_000,
      maxRecordBytes: 1_048_576,
    });
  },

  configureServer(
    config: DeploymentConfig,
    environment: NodeJS.ProcessEnv,
  ): StorageFactory | undefined {
    if (environment.NODE_ENV !== "production") return undefined;
    const storageFactory = MessageBoardDeployment.storage(config);
    ServerEnvironment.when(EnvironmentType.Production).use({
      storageFactory,
      transport: createZeroMqTransport(
        ZeroMqConfig.create({ ipcDirectory: required(environment, "SPINE_IPC_DIRECTORY") }),
      ),
    });
    return storageFactory;
  },
});

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`Missing required configuration: ${name}.`);
  return value;
}

function port(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535)
    throw new Error("Invalid required configuration: PORT.");
  return parsed;
}
