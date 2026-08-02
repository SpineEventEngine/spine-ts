import {
  type ServerEnvironmentCloseable,
  type ServerEnvironmentDelivery,
} from "@spine-event-engine/server";

import { DeliveryClient } from "../client/client.js";
import type { DeliveryClientOptions, RemovalQuarantine } from "../client/types.js";
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
   * Supplies durable recovery state whose close lifecycle transfers to this delivery.
   */
  readonly removalQuarantine: RemovalQuarantine & ServerEnvironmentCloseable;

  /**
   * Optionally configures bounded client operations.
   */
  readonly clientOptions?: DeliveryClientOptions;
}

/**
 * Opens and closes one remote delivery facility for a server environment.
 *
 * The supplied quarantine transfers to this owner. Opening creates a fresh
 * client and remote adapters, verifies the bounded Admin snapshot, then
 * publishes them. Failed opening closes only that attempt and can be retried.
 */
export class RemoteDelivery implements ServerEnvironmentDelivery {
  readonly #endpoint: string;
  readonly #quarantine: RemoteDeliveryConfig["removalQuarantine"];
  readonly #options: DeliveryClientOptions;
  #bundle: RemoteDeliveryBundle | undefined;
  #opening: Promise<void> | undefined;
  #closing: Promise<void> | undefined;
  #clientClosed = false;
  #quarantineClosed = false;

  private constructor(config: RemoteDeliveryConfig) {
    this.#endpoint = config.endpoint;
    this.#quarantine = config.removalQuarantine;
    this.#options = config.clientOptions ?? {};
  }

  /**
   * Creates an unopened remote delivery owner.
   *
   * @param config Supplies remote endpoint, durable quarantine, and optional client bounds.
   * @returns The environment-owned remote delivery.
   */
  static connectTo(config: RemoteDeliveryConfig): RemoteDelivery {
    return new RemoteDelivery(config);
  }

  /**
   * Opens the remote facility once, sharing concurrent callers.
   *
   * @returns A promise that settles after bounded Admin readiness succeeds.
   */
  open(): Promise<void> {
    if (this.#bundle !== undefined) return Promise.resolve();
    const opening = (this.#opening ??= this.#open());
    void opening.catch(() => {
      if (this.#opening === opening) this.#opening = undefined;
    });
    return opening;
  }
  get inbox(): RemoteInbox {
    if (this.#bundle === undefined) throw new Error("Remote delivery is not open.");
    return this.#bundle.inbox;
  }

  get workRegistry(): RemoteWorkRegistry {
    if (this.#bundle === undefined) throw new Error("Remote delivery is not open.");
    return this.#bundle.workRegistry;
  }

  /**
   * Closes the built facility, client, and transferred quarantine in order.
   *
   * @returns A promise that retries only unfinished close phases after a failure.
   */
  close(): Promise<void> {
    const closing = (this.#closing ??= this.#close());
    void closing.catch(() => {
      if (this.#closing === closing) this.#closing = undefined;
    });
    return closing;
  }

  async #open(): Promise<void> {
    const client = DeliveryClient.connectTo(this.#endpoint, this.#options);
    const inbox = new RemoteInbox(client, this.#quarantine);
    const workRegistry = new RemoteWorkRegistry(client);
    try {
      await client.shardSnapshot();
      this.#bundle = { client, inbox, workRegistry };
    } catch (error) {
      client.close();
      throw error;
    }
  }

  async #close(): Promise<void> {
    const errors: unknown[] = [];
    if (!this.#clientClosed) {
      try {
        this.#bundle?.client.close();
        this.#clientClosed = true;
      } catch (error) {
        errors.push(error);
      }
    }
    if (!this.#quarantineClosed) {
      try {
        await this.#quarantine.close();
        this.#quarantineClosed = true;
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, "RemoteDelivery close failed.");
  }
}

interface RemoteDeliveryBundle {
  readonly client: DeliveryClient;
  readonly inbox: RemoteInbox;
  readonly workRegistry: RemoteWorkRegistry;
}
