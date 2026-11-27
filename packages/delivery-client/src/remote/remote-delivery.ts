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
  type ServerEnvironmentDelivery,
  type ApplicationWorkSource,
} from "@spine-event-engine/server";
import { deliveryPortAccess } from "@spine-event-engine/server/spi/delivery";

import { DeliveryClient } from "../client/client.js";
import type { DeliveryClientOptions } from "../client/types.js";
import { RemoteInbox, RemoteWorkRegistry } from "./adapters.js";

/**
 * Configures one remote delivery facility owned by a server environment.
 */
export interface RemoteDeliveryConfig {
  // prettier-ignore

  /**
   * Supplies the HTTP(S) origin of the delivery server.
   */
  readonly endpoint: string;

  /**
   * Optionally configures bounded client operations.
   */
  readonly clientOptions?: DeliveryClientOptions;

  /**
   * Optionally bounds simultaneous shard runs from server notices.
   */
  readonly notifications?: {
    readonly kind: "delivery-server";
    readonly maxConcurrentDeliveries?: number;
  };
}

/**
 * Opens and closes one remote delivery facility for a server environment.
 *
 * Opening creates a fresh client and remote adapters. The work stream starts
 * after application readiness and can remain idle without delaying startup.
 */
export class RemoteDelivery implements ServerEnvironmentDelivery {
  readonly #endpoint: string;

  readonly #options: DeliveryClientOptions;

  /**
   * Selects server notices.
   */
  readonly notifications: {
    readonly kind: "delivery-server";
    readonly maxConcurrentDeliveries?: number;
  };

  #bundle: RemoteDeliveryBundle | undefined;

  #client: DeliveryClient | undefined;

  #opening: Promise<void> | undefined;

  #closing: Promise<void> | undefined;

  #closed = false;

  #clientClosed = false;

  /**
   * Validates one remote delivery configuration.
   *
   * @param config Supplies the endpoint and observer selection.
   */
  private constructor(config: RemoteDeliveryConfig) {
    const supplied = config.notifications as unknown;
    if (
      supplied !== undefined &&
      (typeof supplied !== "object" ||
        supplied === null ||
        (supplied as { kind?: unknown }).kind !== "delivery-server")
    )
      throw new TypeError("Remote delivery notifications must use delivery-server.");
    if (supplied !== undefined && "shardObserver" in supplied)
      throw new TypeError("Remote delivery does not accept a shard observer.");
    this.#endpoint = config.endpoint;
    this.#options = config.clientOptions ?? {};
    Object.defineProperty(this, deliveryPortAccess, {
      value: () => {
        if (this.#bundle === undefined) throw new Error("Remote delivery is not open.");
        return {
          inbox: this.#bundle.inbox,
          workRegistry: this.#bundle.workRegistry,
          pageSize: this.#bundle.client.pageSize,
        };
      },
    });
    this.notifications = {
      kind: "delivery-server",
      ...(config.notifications?.maxConcurrentDeliveries === undefined
        ? {}
        : { maxConcurrentDeliveries: config.notifications.maxConcurrentDeliveries }),
    };
    const count = this.notifications.maxConcurrentDeliveries;
    if (count !== undefined && (!Number.isSafeInteger(count) || count <= 0))
      throw new TypeError("maxConcurrentDeliveries must be a positive safe integer.");
  }

  /**
   * Creates an unopened remote delivery owner.
   *
   * @param config Supplies remote endpoint and optional client bounds.
   * @returns The environment-owned remote delivery.
   */
  static connectTo(config: RemoteDeliveryConfig): RemoteDelivery {
    return new RemoteDelivery(config);
  }

  /**
   * Opens the remote facility once, sharing concurrent callers.
   *
   * @returns A promise that settles after adapters are available.
   */
  open(): Promise<void> {
    if (this.#closed) return Promise.reject(new Error("Remote delivery is closed."));
    if (this.#bundle !== undefined) return Promise.resolve();
    const opening = (this.#opening ??= this.#open());
    // spine-log-boundary: delivery_client.remote_open_reset
    void opening.catch(() => {
      if (this.#opening === opening) this.#opening = undefined;
    });
    return opening;
  }

  /**
   * Returns the ready remote shard work-registry adapter.
   *
   * @returns The published work registry after readiness succeeds.
   */
  get workRegistry(): RemoteWorkRegistry {
    if (this.#bundle === undefined) throw new Error("Remote delivery is not open.");
    return this.#bundle.workRegistry;
  }

  /**
   * Returns available-work observations for the built-in selection.
   *
   * @returns A fresh work stream for each connection.
   */
  get source(): ApplicationWorkSource {
    if (this.#bundle === undefined) throw new Error("Remote delivery is not open.");
    return this.#bundle.source;
  }

  /**
   * Returns the configured delivery endpoint for work-stream diagnostics.
   *
   * @returns The endpoint supplied at construction.
   */
  get endpoint(): string {
    return this.#endpoint;
  }

  /**
   * Closes the client-owned HTTP/2 session.
   *
   * @returns A promise that retries only unfinished close phases after a failure.
   */
  close(): Promise<void> {
    this.#closed = true;
    const closing = (this.#closing ??= this.#close());
    // spine-log-boundary: delivery_client.remote_close_reset
    void closing.catch(() => {
      if (this.#closing === closing) this.#closing = undefined;
    });
    return closing;
  }

  async #open(): Promise<void> {
    const client = DeliveryClient.connectTo(this.#endpoint, this.#options);
    this.#client = client;
    const inbox = new RemoteInbox(client);
    const workRegistry = new RemoteWorkRegistry(client);
    if (this.#closed) throw new Error("Remote delivery is closed.");
    this.#bundle = {
      client,
      inbox,
      workRegistry,
      source: { observeAvailableShards: (options) => client.observeAvailableShards(options) },
    };
    await Promise.resolve();
  }

  async #close(): Promise<void> {
    const errors: unknown[] = [];
    if (!this.#clientClosed) {
      try {
        this.#client?.close();
        this.#clientClosed = true;
      } catch (error) {
        errors.push(error);
      }
    }
    const opening = this.#opening;
    if (opening !== undefined) {
      try {
        await opening;
        // spine-log-boundary: delivery_client.remote_close_opening
      } catch {
        // Closure makes a pending opening terminal; its resource is handled above.
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, "RemoteDelivery close failed.");
  }
}

interface RemoteDeliveryBundle {
  readonly client: DeliveryClient;
  readonly inbox: RemoteInbox;
  readonly workRegistry: RemoteWorkRegistry;
  readonly source: ApplicationWorkSource;
}
