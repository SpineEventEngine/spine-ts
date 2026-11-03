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
  EnvironmentType,
  ServerEnvironment,
  type DeliveryStrategy,
  type RunningServer,
  type StandSubscriptionRegistry,
} from "@spine-event-engine/server";
import { BrowserServer, type BrowserServerOptions } from "@spine-event-engine/server/browser";
import { InMemoryStorageFactory, type StorageFactory } from "@spine-event-engine/storage";
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
   * @param options Listener settings.
   * @param registryFactory Creates one registry per Bounded Context.
   * @returns The configured contexts or running Server.
   */
  async create(
    options: BoardServerOptions = {},
    registryFactory?: () => StandSubscriptionRegistry,
  ): Promise<ComposedBoard> {
    await ServerEnvironment.instance().completeSetup();
    return new ComposedBoardApplication(this.#admission()?.readerAdmission).create({
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
    this.#localEnvironment();
    const native = (await this.create({ host: "127.0.0.1", port: 0 })).server;
    return BrowserServer.open(await native.start(), this.#browserOptions(options));
  }

  /**
   * Starts the local combined server with process shutdown hooks.
   *
   * @param options Local listener settings.
   * @returns The configured contexts or running Server.
   */
  async run(options: BoardServerOptions = {}): Promise<RunningServer> {
    this.#localEnvironment();
    const native = (await this.create({ host: "127.0.0.1", port: 0 })).server;
    return BrowserServer.run(native, this.#browserOptions(options));
  }

  /**
   * Starts the native application server with deployment-selected storage.
   *
   * @param options Native listener settings.
   * @param storageFactory Deployment-selected storage.
   * @returns The configured contexts or running Server.
   */
  async runApplication(
    options: BoardServerOptions,
    storageFactory: StorageFactory,
  ): Promise<RunningServer> {
    this.#environment(storageFactory);
    return (await this.create(options)).server.run();
  }

  /**
   * Starts a managed native replica with distinct registries for its Bounded Contexts.
   *
   * @param options Native listener settings.
   * @param storageFactory Deployment-selected storage.
   * @param deliveryStrategy Shared Delivery configuration.
   * @param registryFactory Creates one registry per Bounded Context.
   * @returns The configured contexts or running Server.
   */
  async startManagedApplication(
    options: BoardServerOptions,
    storageFactory: StorageFactory,
    deliveryStrategy: DeliveryStrategy,
    registryFactory: () => StandSubscriptionRegistry,
  ): Promise<RunningServer> {
    this.#environment(storageFactory, deliveryStrategy);
    return (await this.create(options, registryFactory)).server.start();
  }

  /**
   * Starts the combined deployment server with one shared domain assembly.
   *
   * @param options Listener and browser settings.
   * @param storageFactory Deployment-selected storage.
   * @returns The configured contexts or running Server.
   */
  async runCombined(
    options: BoardServerOptions,
    storageFactory: StorageFactory,
  ): Promise<RunningServer> {
    this.#environment(storageFactory);
    const native = (await this.create({ host: "127.0.0.1", port: 0 })).server;
    return BrowserServer.run(native, this.#browserOptions(options));
  }

  /**
   * Configures in-memory storage for local example startup.
   */
  #localEnvironment(): void {
    this.#environment(new InMemoryStorageFactory());
  }

  /**
   * Installs the selected storage and delivery facilities in the local Server environment.
   */
  #environment(storageFactory: StorageFactory, deliveryStrategy?: DeliveryStrategy): void {
    ServerEnvironment.when(EnvironmentType.Local).use({
      storageFactory,
      ...(deliveryStrategy === undefined ? {} : { deliveryStrategy }),
    });
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
