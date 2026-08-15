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

import type { Any } from "@bufbuild/protobuf/wkt";
import type { TenantId } from "@spine-event-engine/proto";
import { TenantBoundary } from "@spine-event-engine/storage";

import { Delivery, type DeliveryEndpointMessage } from "../delivery/delivery.js";
import type { DeliveryInbox, DeliveryWorkRegistry } from "../delivery/delivery-ports.js";
import type { DeliverySource } from "../delivery/delivery-supervisor.js";
import { InboxTargets, type InboxMessage } from "../delivery/inbox.js";
import { ShardIndex } from "../delivery/shard-index.js";

/**
 * Names the delivery labels that local inbox routes can handle.
 */
export type SupportedDeliveryLabel = DeliveryEndpointMessage["label"];

/**
 * Describes one delivery target assigned to a shard.
 */
export interface DeliveryEndpoint {
  // prettier-ignore

  /**
   * Names the delivery action performed for the target.
   */
  readonly label: SupportedDeliveryLabel;

  /**
   * Names the target message type.
   */
  readonly targetTypeUrl: string;

  /**
   * Locates the target within its delivery shard set.
   */
  readonly shard: ShardIndex;
}

/**
 * Describes a delivery route that became eligible after persistence.
 */
export interface DeliveryReady extends DeliveryEndpoint {
  // prettier-ignore

  /**
   * Identifies the tenant when this route is tenant-scoped.
   */
  readonly tenantId?: TenantId;
}

/**
 * Observes a delivery route that became eligible after persistence.
 *
 * @param ready Describes the route that is ready to drain.
 * @returns Returns an optional asynchronous observation outcome.
 */
export type OnDeliveryReady = (ready: DeliveryReady) => unknown;

/**
 * Groups the inbox and shard registry selected by a server environment.
 *
 * @internal
 */
export interface EnvironmentDeliveryPorts {
  // prettier-ignore

  /**
   * Persists and reads environment-owned delivery messages.
   */
  readonly inbox: DeliveryInbox;

  /**
   * Coordinates environment-owned shard work.
   */
  readonly workRegistry: DeliveryWorkRegistry;

  /**
   * Supplies remote Admin recovery and notification observations when delivery is remote.
   */
  readonly source?: DeliverySource;
}

/**
 * Coordinates readiness notifications while delivery ownership changes hands.
 */
export class DeliveryReadiness {
  #onReady: OnDeliveryReady;
  readonly #active = new Set<Promise<void>>();
  #mode: "direct" | "transition" | "routed" | "failed" = "direct";
  #configured = new Map<string, DeliveryReady>();
  #buffered = new Map<string, DeliveryReady>();
  #invalidTransition = false;
  #ports: EnvironmentDeliveryPorts | undefined;

  /**
   * Creates a readiness coordinator.
   *
   * @param onReady Observes routes made ready before ownership is transferred.
   */
  constructor(onReady: OnDeliveryReady = () => undefined) {
    this.#onReady = onReady;
  }

  /**
   * Sets the observer used before routing takes ownership.
   *
   * @param onReady Observes routes that become ready.
   * @returns Returns a function that removes this observer when still active.
   */
  onReady(onReady: OnDeliveryReady): () => void {
    if (this.#mode === "routed") {
      return () => undefined;
    }
    this.#onReady = onReady;
    return () => {
      if (this.#onReady === onReady) {
        this.#onReady = () => undefined;
      }
    };
  }

  /**
   * Acquires readiness ownership for a persisted route.
   *
   * @param ready Describes the route when persistence made it ready.
   * @returns Returns a claim that must be completed or abandoned.
   */
  claim(ready?: DeliveryReady): DeliveryHandoff {
    if (this.#mode === "direct") {
      const handoff = this.#directHandoff();
      if (ready !== undefined) {
        this.#notify(ready);
      }
      return handoff;
    }
    if (ready !== undefined) {
      if (this.#mode === "transition") {
        const key = InboxHandoff.readyKey(ready);
        if (this.#configured.has(key)) {
          this.#buffered.set(key, InboxHandoff.cloneReady(ready));
        } else {
          this.#invalidTransition = true;
        }
      } else if (this.#mode === "routed") {
        this.#notify(ready);
      }
    }
    return settledHandoff;
  }

  /**
   * Routes a context-created delivery through the attached environment ports.
   *
   * Direct local delivery remains unchanged. Once ownership is transferred,
   * inbox writes and workers must use the same environment-owned facility.
   *
   * @param delivery Supplies the context-created delivery configuration.
   * @returns The delivery selected for the current ownership mode.
   * @internal
   */
  route(delivery: Delivery): Delivery {
    const ports = this.#ports;
    if (ports === undefined) return delivery;
    return new Delivery({
      context: delivery.context,
      storageFactory: delivery.storageFactory,
      strategy: delivery.strategy,
      node: delivery.node,
      pageSize: delivery.pageSize,
      inbox: ports.inbox,
      workRegistry: ports.workRegistry,
    });
  }

  /**
   * Updates readiness ownership to use configured delivery routes.
   *
   * @param scopes Lists the routes that may receive buffered readiness.
   * @param onReady Observes readiness after routed ownership begins.
   * @param options Allows an empty configured route set when `allowEmpty` is true.
   * @returns A promise that resolves after the readiness transition completes.
   */
  transition(
    scopes: readonly DeliveryReady[],
    onReady: OnDeliveryReady,
    options: {
      readonly allowEmpty?: boolean;
      readonly ports?: EnvironmentDeliveryPorts;
    } = {},
  ): Promise<void> {
    if (this.#mode !== "direct" && this.#mode !== "failed") {
      return Promise.reject(new Error("Delivery readiness ownership is already transferred."));
    }
    let configured: Map<string, DeliveryReady>;
    try {
      configured = InboxHandoff.configuredScopes(scopes, options.allowEmpty === true);
    } catch (error) {
      return Promise.resolve().then(() => {
        throw error;
      });
    }
    this.#configured = configured;
    this.#buffered.clear();
    this.#invalidTransition = false;
    this.#mode = "transition";
    const admitted = [...this.#active];
    return Promise.allSettled(admitted).then(() => {
      if (this.#invalidTransition) {
        this.#buffered.clear();
        this.#mode = "failed";
        throw new Error("Delivery readiness transition received an unconfigured scope.");
      }
      this.#onReady = onReady;
      this.#ports = options.ports;
      this.#mode = "routed";
      for (const ready of this.#buffered.values()) {
        this.#notify(ready);
      }
      this.#buffered.clear();
    });
  }

  #directHandoff(): DeliveryHandoff {
    const gate = Promise.withResolvers<undefined>();
    this.#active.add(gate.promise);
    let abandoned = false;
    let completion: Promise<void> | undefined;
    const finish = (): void => {
      gate.resolve(undefined);
      this.#active.delete(gate.promise);
    };
    return Object.freeze({
      complete: (onDrain: () => Promise<void>) => {
        if (completion !== undefined) {
          return completion;
        }
        if (abandoned) {
          return settled;
        }
        const shared = Promise.withResolvers<undefined>();
        completion = shared.promise;
        void completion.then(finish, finish);
        try {
          void Promise.resolve(onDrain()).then(() => {
            shared.resolve(undefined);
          }, shared.reject);
        } catch (error) {
          shared.reject(error);
        }
        return completion;
      },
      abandon: () => {
        if (completion !== undefined || abandoned) {
          return;
        }
        abandoned = true;
        finish();
      },
    });
  }

  #notify(ready: DeliveryReady): void {
    try {
      const result = Reflect.apply(this.#onReady, undefined, [ready]);
      if (InboxHandoff.isPromiseLike(result)) {
        void Promise.resolve(result).catch(() => undefined);
      }
    } catch {
      // Readiness observation cannot alter durable receive or exact-drain outcomes.
    }
  }
}

/**
 * Represents a post-persistence claim held while direct delivery remains active.
 */
export interface DeliveryHandoff {
  // prettier-ignore

  /**
   * Completes the claim after draining the durable message.
   *
   * @param onDrain Drains the message associated with this claim.
   * @returns A promise that resolves after the claim drains and completes.
   */
  complete(onDrain: () => Promise<void>): Promise<void>;

  /**
   * Cancels the claim without draining it.
   */
  abandon(): void;
}

const settled = Promise.resolve();
const settledHandoff: DeliveryHandoff = Object.freeze({
  complete: () => settled,
  abandon: () => undefined,
});

const drainLimit = 8;

/**
 * Configures one bounded attempt to drain a local inbox message.
 */
export interface LocalInboxDrainOptions {
  // prettier-ignore

  /**
   * Selects the delivery runtime that owns the inbox message.
   */
  readonly delivery: Delivery;

  /**
   * Identifies the persisted message to drain.
   */
  readonly received: InboxMessage;

  /**
   * Names the local delivery node acquiring the message.
   */
  readonly node: string;

  /**
   * Calls target replay after the delivery runtime acquires a message.
   *
   * @param message Contains the acquired inbox message.
   * @returns Resolves after the target replay finishes.
   */
  readonly onReplay: (message: InboxMessage) => Promise<void> | void;

  /**
   * Determines whether the replay callback owns a message.
   *
   * @param message Contains a pending Inbox message.
   * @returns `true` when the replay callback owns the message.
   * @internal
   */
  readonly acceptMessage?: (message: InboxMessage) => boolean;

  /**
   * Observes exact durable acknowledgements produced by the same shard drain.
   *
   * @param message Contains the acknowledged Inbox message.
   * @internal
   */
  readonly onAcknowledged?: (message: InboxMessage) => void;

  /**
   * Explains a replay failure that lacks an Error instance.
   */
  readonly replayFailureMessage: string;

  /**
   * Explains a delivery skipped before target replay.
   */
  readonly skippedMessage: string;

  /**
   * Explains exhaustion of local drain attempts.
   */
  readonly unfinishedMessage: string;
}

/**
 * Identifies the fields that deduplicate an in-flight inbox handoff.
 */
export interface LocalInboxKeyInput {
  // prettier-ignore

  /**
   * Identifies the inbox target receiving the message.
   */
  readonly inboxId: {
    readonly targetId: Any;
    readonly targetTypeUrl: string;
  };

  /**
   * Identifies the source signal persisted in the inbox.
   */
  readonly signalId: string;

  /**
   * Names the delivery action for the message.
   */
  readonly label: InboxMessage["label"];

  /**
   * Locates the message in its delivery shard set.
   */
  readonly shard: InboxMessage["shard"];
}

/**
 * Coordinates durable local inbox ownership and delivery handoffs.
 */
export const InboxHandoff: Readonly<{
  ready(endpoint: DeliveryEndpoint, tenantId?: TenantId): DeliveryReady;
  configuredScopes(
    scopes: readonly DeliveryReady[],
    allowEmpty: boolean,
  ): Map<string, DeliveryReady>;
  readyKey(ready: DeliveryReady): string;
  cloneReady(ready: DeliveryReady): DeliveryReady;
  isPromiseLike(value: unknown): value is PromiseLike<unknown>;
  coordinate(options: {
    readonly handoffs: Map<string, Promise<InboxMessage>>;
    readonly key: string;
    readonly onHandoff: () => Promise<InboxMessage>;
  }): Promise<InboxMessage>;
  drain(options: LocalInboxDrainOptions): Promise<void>;
  runDrain(options: LocalInboxDrainOptions): Promise<void>;
  key(input: LocalInboxKeyInput, tenantId?: TenantId): string;
  sameMessageId(
    left: {
      readonly value: string;
      readonly shard: { readonly index: number; readonly ofTotal: number };
    },
    right: {
      readonly value: string;
      readonly shard: { readonly index: number; readonly ofTotal: number };
    },
  ): boolean;
  messageIdKey(message: Pick<InboxMessage, "id">): string;
  endpoint(input: {
    readonly label: SupportedDeliveryLabel;
    readonly inboxId: { readonly targetTypeUrl: string };
    readonly shard: ShardIndex;
  }): DeliveryEndpoint;
  configuredEndpoint(
    message: InboxMessage,
    endpoints: readonly DeliveryEndpoint[],
  ): DeliveryEndpoint | undefined;
}> = Object.freeze({
  ready(endpoint: DeliveryEndpoint, tenantId?: TenantId): DeliveryReady {
    return Object.freeze({
      ...(tenantId === undefined ? {} : { tenantId }),
      label: endpoint.label,
      targetTypeUrl: endpoint.targetTypeUrl,
      shard: new ShardIndex(endpoint.shard.index, endpoint.shard.ofTotal),
    });
  },

  configuredScopes(
    scopes: readonly DeliveryReady[],
    allowEmpty: boolean,
  ): Map<string, DeliveryReady> {
    const configured = new Map<string, DeliveryReady>();
    for (const scope of scopes) {
      configured.set(InboxHandoff.readyKey(scope), InboxHandoff.cloneReady(scope));
    }
    if (configured.size === 0 && !allowEmpty) {
      throw new Error("Delivery readiness transition requires configured scopes.");
    }
    return configured;
  },

  readyKey(ready: DeliveryReady): string {
    return JSON.stringify([
      tenantKey(ready.tenantId),
      ready.label,
      ready.targetTypeUrl,
      ready.shard.index,
      ready.shard.ofTotal,
    ]);
  },

  cloneReady(ready: DeliveryReady): DeliveryReady {
    return InboxHandoff.ready(ready, ready.tenantId);
  },

  isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
      return false;
    }
    return "then" in value && typeof value.then === "function";
  },

  async coordinate(options: {
    readonly handoffs: Map<string, Promise<InboxMessage>>;
    readonly key: string;
    readonly onHandoff: () => Promise<InboxMessage>;
  }): Promise<InboxMessage> {
    const inFlightHandoff = options.handoffs.get(options.key);

    if (inFlightHandoff !== undefined) {
      return await inFlightHandoff;
    }

    const handoff = options.onHandoff();
    options.handoffs.set(options.key, handoff);
    try {
      return await handoff;
    } finally {
      if (options.handoffs.get(options.key) === handoff) {
        options.handoffs.delete(options.key);
      }
    }
  },

  async drain(options: LocalInboxDrainOptions): Promise<void> {
    await InboxHandoff.runDrain(options);
  },

  async runDrain(options: LocalInboxDrainOptions): Promise<void> {
    const {
      delivery,
      received,
      node,
      onReplay,
      replayFailureMessage,
      skippedMessage,
      unfinishedMessage,
    } = options;

    for (let attempt = 0; attempt < drainLimit; attempt += 1) {
      const direct = await delivery.drainMessage(received, {
        node,
        onMessage: onReplay,
        ...(options.acceptMessage === undefined ? {} : { acceptMessage: options.acceptMessage }),
        ...(options.onAcknowledged === undefined ? {} : { onDelivered: options.onAcknowledged }),
      });
      if (direct.acknowledged) return;
      const run = direct.run;
      const target = await delivery.inbox.readMessage(received.id);

      if (target?.status === "DELIVERED") {
        return;
      }

      const failure = run.failures.find(({ message }) =>
        InboxHandoff.sameMessageId(message.id, received.id),
      );

      if (failure !== undefined) {
        throw failure.error instanceof Error
          ? failure.error
          : new Error(replayFailureMessage, { cause: failure.error });
      }
      if (run.status === "SKIPPED") {
        throw new Error(skippedMessage);
      }
      if (run.accepted === 0 && run.delivered === 0 && run.failed === 0) {
        break;
      }
    }

    throw new Error(unfinishedMessage);
  },

  key(input: LocalInboxKeyInput, deliveryTenantId?: TenantId): string {
    return JSON.stringify([
      tenantKey(deliveryTenantId),
      input.label,
      input.signalId,
      input.inboxId.targetTypeUrl,
      InboxTargets.key(input.inboxId.targetId),
      input.shard.index,
      input.shard.ofTotal,
    ]);
  },

  sameMessageId(
    left: {
      readonly value: string;
      readonly shard: { readonly index: number; readonly ofTotal: number };
    },
    right: {
      readonly value: string;
      readonly shard: { readonly index: number; readonly ofTotal: number };
    },
  ): boolean {
    return (
      left.value === right.value &&
      left.shard.index === right.shard.index &&
      left.shard.ofTotal === right.shard.ofTotal
    );
  },

  messageIdKey(message: Pick<InboxMessage, "id">): string {
    return JSON.stringify([message.id.value, message.id.shard.index, message.id.shard.ofTotal]);
  },

  endpoint(input: {
    readonly label: SupportedDeliveryLabel;
    readonly inboxId: { readonly targetTypeUrl: string };
    readonly shard: ShardIndex;
  }): DeliveryEndpoint {
    return Object.freeze({
      label: input.label,
      targetTypeUrl: input.inboxId.targetTypeUrl,
      shard: new ShardIndex(input.shard.index, input.shard.ofTotal),
    });
  },

  configuredEndpoint(
    message: InboxMessage,
    endpoints: readonly DeliveryEndpoint[],
  ): DeliveryEndpoint | undefined {
    if (message.status !== "TO_DELIVER") {
      return undefined;
    }
    return endpoints.find(
      (endpoint) =>
        endpoint.targetTypeUrl === message.inboxId.targetTypeUrl &&
        endpoint.label === message.label &&
        endpoint.shard.key() === message.shard.key(),
    );
  },
});

function tenantKey(tenantId: TenantId | undefined): string {
  return tenantId === undefined ? "" : String(TenantBoundary.from(tenantId).key);
}
