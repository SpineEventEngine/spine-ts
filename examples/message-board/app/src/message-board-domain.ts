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
 * Starts every Message Board mode from the same two-Bounded-Context assembly.
 */

import {
  Environment,
  ServerEnvironment,
  type DeliveryStrategy,
  type RunningServer,
  type ServerEnvironmentDelivery,
  type StandSubscriptionRegistry,
} from "@spine-event-engine/server";
import { BrowserServer, type BrowserServerOptions } from "@spine-event-engine/server/browser";
import { InMemoryStorageFactory, type StorageFactory } from "@spine-event-engine/storage";
import type { ILogLayer } from "loglayer";
import {
  ComposedBoardApplication,
  type ComposedBoard,
} from "@spine-event-engine/example-message-board-composed-app";
import type {
  AnnouncementBoardView,
  BoardMessage,
  BoardMessageView,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";

import { BoardAccessPolicy, BoardContextResolver } from "./board-access.js";
import { SystemClock } from "./system-clock.js";
import { typeRegistry } from "./model-registry.js";
import { BoardAdmission, type SignedBoardAdmission } from "./signed-admission.js";

export { typeRegistry } from "./model-registry.js";
export { messageBoardProtoModule } from "@spine-event-engine/example-message-board-model";
export { BoardAccessPolicy, BoardContextResolver } from "./board-access.js";
export { BoardMessageAggregate } from "@spine-event-engine/example-message-board-command-handlers";

/**
 * Configures the native listener and browser origin.
 */
export interface BoardServerOptions {
  /**
   * Selects the native listener host.
   */
  readonly host?: string;

  /**
   * Selects the native listener port.
   */
  readonly port?: number;

  /**
   * Selects the allowed browser origin.
   */
  readonly webOrigin?: string;
}

/**
 * Facilities selected for one Message Board Application process.
 */
export interface BoardApplicationFacilities {
  /**
   * Stores Application state and Delivery records.
   */
  readonly storageFactory: StorageFactory;

  /**
   * Connects this process to remote Delivery when configured.
   */
  readonly delivery?: ServerEnvironmentDelivery;

  /**
   * Receives server lifecycle diagnostics.
   */
  readonly logger?: ILogLayer;
}

/**
 * Reuses the composed Message Board in local, managed, and combined processes.
 */
export class MessageBoardApplication {
  #signed: SignedBoardAdmission | undefined;

  /**
   * Creates an application from the selected process configuration.
   *
   * @param configuration Protected application configuration.
   */
  constructor(private readonly configuration: NodeJS.ProcessEnv = process.env) {}

  /**
   * Builds both Bounded Contexts from the already selected environment.
   *
   * @param environment Configured facilities for the Message Board Application.
   * @param options Listener settings.
   * @param registryFactory Creates one registry per Bounded Context.
   * @returns The configured contexts or running Server.
   */
  async create(
    environment: ServerEnvironment,
    options: BoardServerOptions = {},
    registryFactory?: () => StandSubscriptionRegistry,
  ): Promise<ComposedBoard> {
    return new ComposedBoardApplication(this.#admission()?.readerAdmission).create(environment, {
      host: options.host ?? "127.0.0.1",
      port: options.port ?? 0,
      ...(registryFactory === undefined ? {} : { registryFactory }),
    });
  }

  /**
   * Starts the local combined native and browser server.
   *
   * @param options Local listener settings.
   * @returns The configured contexts or running Server.
   */
  async start(options: BoardServerOptions = {}): Promise<RunningServer> {
    const browserOptions = this.#browserOptions(options);
    const composed = await this.create(this.#localEnvironment(), { host: "127.0.0.1", port: 0 });
    const native = await this.#startNative(composed);
    return BrowserServer.open(native, browserOptions);
  }

  /**
   * Starts the local combined server with process shutdown hooks.
   *
   * @param options Local listener settings.
   * @returns The configured contexts or running Server.
   */
  async run(options: BoardServerOptions = {}): Promise<RunningServer> {
    const browserOptions = this.#browserOptions(options);
    const composed = await this.create(this.#localEnvironment(), { host: "127.0.0.1", port: 0 });
    return this.#runBrowser(composed, browserOptions);
  }

  /**
   * Starts the native application server with deployment-selected storage.
   *
   * @param options Native listener settings.
   * @param facilities Deployment-selected storage, Delivery, and logging.
   * @returns The configured contexts or running Server.
   */
  async runApplication(
    options: BoardServerOptions,
    facilities: BoardApplicationFacilities,
  ): Promise<RunningServer> {
    const composed = await this.create(this.#environment(facilities), options);
    return composed.server.run();
  }

  /**
   * Starts a managed native replica with distinct registries for its Bounded Contexts.
   *
   * @param options Native listener settings.
   * @param facilities Deployment-selected storage, Delivery, and logging.
   * @param deliveryStrategy Shared Delivery configuration.
   * @param registryFactory Creates one registry per Bounded Context.
   * @returns The configured contexts or running Server.
   */
  async startManagedApplication(
    options: BoardServerOptions,
    facilities: BoardApplicationFacilities,
    deliveryStrategy: DeliveryStrategy,
    registryFactory: () => StandSubscriptionRegistry,
  ): Promise<RunningServer> {
    const environment = this.#environment(facilities, deliveryStrategy);
    const composed = await this.create(environment, options, registryFactory);
    return this.#startNative(composed);
  }

  /**
   * Starts the combined deployment server with one shared domain assembly.
   *
   * @param options Listener and browser settings.
   * @param facilities Deployment-selected storage, Delivery, and logging.
   * @returns The configured contexts or running Server.
   */
  async runCombined(
    options: BoardServerOptions,
    facilities: BoardApplicationFacilities,
  ): Promise<RunningServer> {
    const browserOptions = this.#browserOptions(options);
    const environment = this.#environment(facilities);
    const composed = await this.create(environment, { host: "127.0.0.1", port: 0 });
    return this.#runBrowser(composed, browserOptions);
  }

  /**
   * Starts both listeners and closes the assembled Application on startup failure.
   *
   * @param composed Assembled native Message Board.
   * @param options Browser listener and admission settings.
   * @returns Both running listeners.
   */
  async #runBrowser(
    composed: ComposedBoard,
    options: BrowserServerOptions,
  ): Promise<RunningServer> {
    try {
      return await BrowserServer.run(composed.server, options);
    } catch (error) {
      try {
        await composed.application.close();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], "Message Board browser startup cleanup failed.");
      }
      throw error;
    }
  }

  /**
   * Configures in-memory storage for local example startup.
   */
  #localEnvironment(): ServerEnvironment {
    return this.#environment({ storageFactory: new InMemoryStorageFactory() });
  }

  /**
   * Installs the selected storage and delivery facilities in the local Server environment.
   */
  #environment(
    facilities: BoardApplicationFacilities,
    deliveryStrategy?: DeliveryStrategy,
  ): ServerEnvironment {
    return ServerEnvironment.newBuilder()
      .under(Environment.instance().type, (setting) => {
        setting.use({
          storageFactory: facilities.storageFactory,
          typeRegistry,
          ...(deliveryStrategy === undefined ? {} : { deliveryStrategy }),
          ...(facilities.delivery === undefined ? {} : { delivery: facilities.delivery }),
          ...(facilities.logger === undefined ? {} : { logger: facilities.logger }),
        });
      })
      .build();
  }

  /**
   * Starts the native endpoint and keeps Application shutdown after its close.
   *
   * @param composed Message Board Application and Server builder.
   * @returns Native endpoint with Application cleanup.
   */
  async #startNative(composed: ComposedBoard): Promise<RunningServer> {
    let endpoint: RunningServer;
    try {
      endpoint = await composed.server.start();
    } catch (error) {
      try {
        await composed.application.close();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], "Message Board startup cleanup failed.");
      }
      throw error;
    }
    return {
      host: endpoint.host,
      port: endpoint.port,
      baseUrl: endpoint.baseUrl,
      close: async () => {
        await endpoint.close();
        await composed.application.close();
      },
    };
  }

  /**
   * Builds Gateway settings from the selected admission mode and listener options.
   */
  #browserOptions(options: BoardServerOptions): BrowserServerOptions {
    const policy = new BoardAccessPolicy();
    const signed = this.#admission();
    return {
      host: options.host ?? "127.0.0.1",
      port: options.port ?? 0,
      origins: [options.webOrigin ?? "http://127.0.0.1:5173"],
      registry: typeRegistry,
      ...(signed === undefined
        ? { publicAccess: true as const }
        : {
            sessions: signed.sessions,
            forwardingProof: signed.forwardingProof,
          }),
      authorize: policy.authorize.bind(policy),
      contexts: new BoardContextResolver(),
      clock: new SystemClock(),
    };
  }

  /**
   * Resolves signed admission once when configured for the deployment.
   */
  #admission(): SignedBoardAdmission | undefined {
    if ((this.configuration.MESSAGE_BOARD_AUTH_MODE ?? "public") === "public") return undefined;
    return (this.#signed ??= BoardAdmission.configured(this.configuration));
  }
}

export type { AnnouncementBoardView, BoardMessage, BoardMessageView };
