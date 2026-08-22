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
 * Reads environment settings and assembles shared production facilities for
 * the Message Board application, Gateway, combined, and managed entrypoints.
 */

import { RemoteDelivery } from "@spine-event-engine/delivery-client";
import { StringifierRegistry } from "@spine-event-engine/core";
import {
  EnvironmentType,
  ServerEnvironment,
  type ServerEnvironmentDelivery,
} from "@spine-event-engine/server";
import type { StorageFactory } from "@spine-event-engine/storage";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import type { Datastore } from "@google-cloud/datastore";
import { Logging, type Log } from "@google-cloud/logging";
import { GoogleCloudLoggingTransport } from "@loglayer/transport-google-cloud-logging";
import { LogLayer, type ILogLayer } from "loglayer";

import type { BoardServerOptions } from "./index.js";
import { typeRegistry } from "./model-registry.js";

interface DeploymentConfig extends BoardServerOptions {
  readonly host: string;
  readonly port: number;
  readonly projectId: string;
}

interface CombinedConfig extends DeploymentConfig {
  readonly webOrigin: string;
}

interface GatewayConfig extends CombinedConfig {
  readonly backendUrls?: readonly [string, ...string[]];
  readonly discovery?: { readonly serviceName: string; readonly port: number };
}

interface ManagedConfig extends DeploymentConfig {
  readonly processCount: number;
  readonly deliveryShardCount: number;
}

interface ManagedServerFacilities {
  readonly storageFactory: StorageFactory;
  readonly delivery?: ServerEnvironmentDelivery;
}

interface DeploymentContract {
  application(environment: NodeJS.ProcessEnv): DeploymentConfig;
  combined(environment: NodeJS.ProcessEnv): CombinedConfig;
  gateway(environment: NodeJS.ProcessEnv): GatewayConfig;
  managed(environment: NodeJS.ProcessEnv): ManagedConfig;
  storage(client: Datastore): StorageFactory;
  logger(projectId: string, environment: NodeJS.ProcessEnv): ILogLayer | undefined;
  cloudLogger(log: Log): ILogLayer;

  configureServer(
    config: DeploymentConfig,
    client: Datastore,
    environment: NodeJS.ProcessEnv,
    logger?: ILogLayer,
  ): StorageFactory | undefined;
  configureGatewayServer(
    config: GatewayConfig,
    storageFactory: StorageFactory,
    logger?: ILogLayer,
  ): void;
  configureManagedServer(
    config: DeploymentConfig,
    client: Datastore,
    environment: NodeJS.ProcessEnv,
    logger?: ILogLayer,
  ): ManagedServerFacilities;
}

/**
 * Reads the finite MessageBoard runtime configuration without exposing values in errors.
 */
export const MessageBoardDeployment: DeploymentContract = Object.freeze({
  application(environment: NodeJS.ProcessEnv): DeploymentConfig {
    return {
      host: DeploymentValues.required(environment, "HOST"),
      port: DeploymentValues.port(DeploymentValues.required(environment, "PORT")),
      projectId: DeploymentValues.required(environment, "DATASTORE_PROJECT_ID"),
    };
  },

  combined(environment: NodeJS.ProcessEnv): CombinedConfig {
    return {
      ...MessageBoardDeployment.application(environment),
      webOrigin: DeploymentValues.required(environment, "BROWSER_ORIGIN"),
    };
  },

  gateway(environment: NodeJS.ProcessEnv): GatewayConfig {
    const serviceName = environment.BACKEND_DISCOVERY_SERVICE;
    if (serviceName !== undefined && serviceName.length > 0)
      return {
        ...MessageBoardDeployment.combined(environment),
        discovery: {
          serviceName,
          port: DeploymentValues.port(
            DeploymentValues.required(environment, "BACKEND_DISCOVERY_PORT"),
          ),
        },
      };
    return {
      ...MessageBoardDeployment.combined(environment),
      backendUrls: DeploymentValues.backendUrls(environment),
    };
  },

  managed(environment: NodeJS.ProcessEnv): ManagedConfig {
    return {
      ...MessageBoardDeployment.application(environment),
      processCount: DeploymentValues.positiveSafeInteger(
        DeploymentValues.required(environment, "PROCESS_COUNT"),
        "PROCESS_COUNT",
      ),
      deliveryShardCount: DeploymentValues.positiveSafeInteger(
        DeploymentValues.required(environment, "DELIVERY_SHARD_COUNT"),
        "DELIVERY_SHARD_COUNT",
      ),
    };
  },

  storage(client: Datastore): StorageFactory {
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(typeRegistry);
    return DatastoreStorageFactory.newBuilder()
      .setClient(client)
      .setStringifierRegistry(stringifiers)
      .build();
  },

  logger(projectId: string, environment: NodeJS.ProcessEnv): ILogLayer | undefined {
    if (environment.DATASTORE_EMULATOR_HOST !== undefined) return undefined;
    return MessageBoardDeployment.cloudLogger(new Logging({ projectId }).log("message-board"));
  },

  cloudLogger(log: Log): ILogLayer {
    return new LogLayer({
      transport: new GoogleCloudLoggingTransport({ logger: log }),
    });
  },

  configureServer(
    config: DeploymentConfig,
    client: Datastore,
    environment: NodeJS.ProcessEnv,
    logger?: ILogLayer,
  ): StorageFactory | undefined {
    if (environment.NODE_ENV !== "production") return undefined;
    return MessageBoardDeployment.configureManagedServer(config, client, environment, logger)
      .storageFactory;
  },

  configureGatewayServer(
    _config: GatewayConfig,
    storageFactory: StorageFactory,
    logger?: ILogLayer,
  ): void {
    ServerEnvironment.when(EnvironmentType.Production).use({
      storageFactory,
      ...(logger === undefined ? {} : { logger }),
      typeRegistry,
    });
  },

  configureManagedServer(
    config: DeploymentConfig,
    client: Datastore,
    environment: NodeJS.ProcessEnv,
    logger?: ILogLayer,
  ): ManagedServerFacilities {
    const storageFactory = MessageBoardDeployment.storage(client);
    const delivery = RemoteDelivery.connectTo({
      endpoint: DeploymentValues.url(DeploymentValues.required(environment, "DELIVERY_SERVER_URL")),
    });
    ServerEnvironment.when(EnvironmentType.Production).use({
      storageFactory,
      ...(logger === undefined ? {} : { logger }),
      typeRegistry,
      delivery,
    });
    return { storageFactory, delivery };
  },
});

/**
 * Reads and validates primitive deployment configuration values.
 */
const DeploymentValues = Object.freeze({
  // prettier-ignore

  /**
   * Reads one required non-empty environment value.
   *
   * @param environment The process environment that supplies configuration.
   * @param name The required environment variable name.
   * @returns The configured non-empty value.
   */
  required(environment: NodeJS.ProcessEnv, name: string): string {
    const value = environment[name];
    if (value === undefined || value.length === 0)
      throw new Error(`Missing required configuration: ${name}.`);
    return value;
  },

  backendUrls(environment: NodeJS.ProcessEnv): readonly [string, ...string[]] {
    const configured = environment.BACKEND_URLS;
    if (configured === undefined || configured.length === 0)
      return [DeploymentValues.required(environment, "BACKEND_URL")];
    const values = configured.split(",").map((value) => value.trim());
    if (values.some((value) => value.length === 0))
      throw new Error("Invalid required configuration: BACKEND_URLS.");
    const [first, ...rest] = values;
    if (first === undefined) throw new Error("Invalid required configuration: BACKEND_URLS.");
    return [first, ...rest];
  },

  /**
   * Parses one valid TCP port.
   *
   * @param value The required decimal port value.
   * @returns The validated TCP port number.
   */
  port(value: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535)
      throw new Error("Invalid required configuration: PORT.");
    return parsed;
  },

  positiveSafeInteger(value: string, name: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1)
      throw new Error(`Invalid required configuration: ${name}.`);
    return parsed;
  },

  /**
   * Validates one delivery-server endpoint.
   *
   * @param value The configured endpoint value.
   * @returns The normalized HTTP(S) endpoint.
   */
  url(value: string): string {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Invalid required configuration: DELIVERY_SERVER_URL.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new Error("Invalid required configuration: DELIVERY_SERVER_URL.");
    return url.toString().replace(/\/$/u, "");
  },
});
