import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import type { StorageFactory } from "@spine-event-engine/storage";

import type { BoardServerOptions } from "./index.js";

interface DeploymentConfig extends BoardServerOptions {
  readonly projectId: string;
}

interface GatewayConfig {
  readonly host: string;
  readonly port: number;
  readonly webOrigin: string;
  readonly backendUrl: string;
}

interface DeploymentContract {
  application(environment: NodeJS.ProcessEnv): DeploymentConfig;
  combined(environment: NodeJS.ProcessEnv): DeploymentConfig;
  gateway(environment: NodeJS.ProcessEnv): GatewayConfig;
  storage(config: DeploymentConfig): StorageFactory;
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

  combined(environment: NodeJS.ProcessEnv): DeploymentConfig {
    return {
      ...MessageBoardDeployment.application(environment),
      webOrigin: required(environment, "BROWSER_ORIGIN"),
    };
  },

  gateway(environment: NodeJS.ProcessEnv): GatewayConfig {
    return {
      host: required(environment, "HOST"),
      port: port(required(environment, "PORT")),
      webOrigin: required(environment, "BROWSER_ORIGIN"),
      backendUrl: required(environment, "BACKEND_URL"),
    };
  },

  storage(config: DeploymentConfig): StorageFactory {
    return DatastoreStorageFactory.create({ projectId: config.projectId });
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
