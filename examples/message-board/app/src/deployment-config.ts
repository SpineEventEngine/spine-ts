import { RemoteDelivery } from "@spine-event-engine/delivery-client";
import { SignedSessions } from "@spine-event-engine/auth";
import {
  DurableSubscriptionBindings,
  EnvironmentType,
  ServerEnvironment,
} from "@spine-event-engine/server";
import type { StorageFactory } from "@spine-event-engine/storage";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import { ZeroMqConfig, createZeroMqTransport } from "@spine-event-engine/transport/zeromq";
import { randomUUID } from "node:crypto";
import { createPrivateKey } from "node:crypto";

import { DeliveryQuarantine } from "./delivery-quarantine.js";
import { MessageBoardSessionRevocations } from "./session-revocations.js";
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
  readonly backendUrls?: readonly string[];
  readonly discovery?: { readonly serviceName: string; readonly port: number };
}

interface DeploymentContract {
  application(environment: NodeJS.ProcessEnv): DeploymentConfig;
  combined(environment: NodeJS.ProcessEnv): CombinedConfig;
  gateway(environment: NodeJS.ProcessEnv): GatewayConfig;
  storage(config: DeploymentConfig): StorageFactory;
  bindings(config: CombinedConfig, storageFactory: StorageFactory): DurableSubscriptionBindings;

  /**
   * Creates production browser sessions that share signing and revocation configuration.
   *
   * The supplied factory owns the underlying revocation handle for the process
   * lifetime. Closing that factory makes later revocation reads fail closed.
   *
   * @param storageFactory The application-selected storage factory.
   * @param environment The process environment that supplies shared settings.
   * @returns The configured signed-session resolver and issuer.
   */
  sessions(storageFactory: StorageFactory, environment: NodeJS.ProcessEnv): SignedSessions;
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
      host: DeploymentValues.required(environment, "HOST"),
      port: DeploymentValues.port(DeploymentValues.required(environment, "PORT")),
      projectId: DeploymentValues.required(environment, "DATASTORE_PROJECT_ID"),
    };
  },

  combined(environment: NodeJS.ProcessEnv): CombinedConfig {
    return {
      ...MessageBoardDeployment.application(environment),
      webOrigin: DeploymentValues.required(environment, "BROWSER_ORIGIN"),
      subscriptionNamespace: DeploymentValues.required(
        environment,
        "SUBSCRIPTION_REGISTRY_NAMESPACE",
      ),
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

  sessions(storageFactory: StorageFactory, environment: NodeJS.ProcessEnv): SignedSessions {
    if (environment.NODE_ENV !== "production")
      throw new Error("Signed MessageBoard sessions require production configuration.");
    return new SignedSessions({
      issuer: DeploymentValues.required(environment, "MESSAGE_BOARD_SESSION_ISSUER"),
      audience: DeploymentValues.required(environment, "MESSAGE_BOARD_SESSION_AUDIENCE"),
      activeKey: {
        kid: DeploymentValues.required(environment, "MESSAGE_BOARD_SESSION_KEY_ID"),
        privateKey: createPrivateKey(
          DeploymentValues.required(environment, "MESSAGE_BOARD_SESSION_PRIVATE_KEY"),
        ),
      },
      revocation: new MessageBoardSessionRevocations(
        storageFactory,
        DeploymentValues.required(environment, "SUBSCRIPTION_REGISTRY_NAMESPACE"),
      ),
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
        ZeroMqConfig.create({
          ipcDirectory: DeploymentValues.required(environment, "SPINE_IPC_DIRECTORY"),
        }),
      ),
      delivery: RemoteDelivery.connectTo({
        endpoint: DeploymentValues.url(
          DeploymentValues.required(environment, "DELIVERY_SERVER_URL"),
        ),
        removalQuarantine: new DeliveryQuarantine(storageFactory),
      }),
    });
    return storageFactory;
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

  backendUrls(environment: NodeJS.ProcessEnv): readonly string[] {
    const configured = environment.BACKEND_URLS;
    if (configured === undefined || configured.length === 0)
      return [DeploymentValues.required(environment, "BACKEND_URL")];
    const values = configured.split(",").map((value) => value.trim());
    if (values.some((value) => value.length === 0))
      throw new Error("Invalid required configuration: BACKEND_URLS.");
    return values;
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
