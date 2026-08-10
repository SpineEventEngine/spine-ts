import { create, toBinary } from "@bufbuild/protobuf";
import type { ILogLayer } from "loglayer";
import {
  SubscriptionIdSchema,
  SubscriptionSchema,
  type SubscriptionUpdate,
} from "@spine-event-engine/proto/client";

import type { EventBus } from "../bus/event-bus.js";
import { emitServerWarning } from "../server/server-log.js";
import { SubscriptionObservers } from "./subscription-observer.js";
import { standAccess, type Stand, type StandSubscription } from "./stand.js";
import type { StandSubscriptionEntry, StandSubscriptionRegistry } from "./subscription-registry.js";

interface LocalSubscriptionAttachment {
  readonly identity: Uint8Array;
  readonly subscription: StandSubscription;
}

const subscriptionRuntimeLoggers = new WeakMap<SubscriptionRuntime, ILogLayer>();
const subscriptionRuntimes = new WeakSet<SubscriptionRuntime>();

interface SubscriptionRuntimeAccess {
  installLogger(runtime: SubscriptionRuntime, logger: ILogLayer): void;
  clearLogger(runtime: SubscriptionRuntime): void;
  loggerFor(runtime: SubscriptionRuntime): ILogLayer;
}

/**
 * Coordinates the local delivery side of one paired bounded context's durable
 * subscription registry.
 *
 * The runtime owns exactly one registry snapshot loop, timer, attachment map,
 * and consumer map. It classifies a target from domain Stand metadata before
 * attaching it: domain events observe only the domain bus, while entity-state
 * updates observe only the paired System bus. This keeps a subscription ID and
 * attachment identity attached once, while allowing all active service streams to share
 * the same rendered update.
 *
 * @internal
 */
export class SubscriptionRuntime {
  readonly #domainStand: Stand;
  readonly #systemStand: Stand;
  readonly #domainEventBus: EventBus;
  readonly #systemEventBus: EventBus;
  readonly #registry: StandSubscriptionRegistry;
  readonly #consumers = new Map<string, Set<(update: SubscriptionUpdate) => void>>();
  readonly #attachments = new Map<string, LocalSubscriptionAttachment>();
  #tail: Promise<void> = Promise.resolve();
  #timer: ReturnType<typeof setInterval> | undefined;
  #timerReconciliation: Promise<void> | undefined;
  #closing = false;
  #closed: Promise<void> | undefined;

  /**
   * Creates an unstarted runtime for a paired domain and System Stand.
   *
   * @param domainStand Supplies authoritative domain state metadata.
   * @param systemStand Retained as the paired state-observer owner boundary.
   * @param domainEventBus Delivers domain-event subscription targets.
   * @param systemEventBus Delivers Entity state and lifecycle subscription targets.
   * @param registry Stores canonical subscription definitions in the domain namespace.
   */
  constructor(
    domainStand: Stand,
    systemStand: Stand,
    domainEventBus: EventBus,
    systemEventBus: EventBus,
    registry: StandSubscriptionRegistry,
  ) {
    subscriptionRuntimes.add(this);
    this.#domainStand = domainStand;
    this.#systemStand = systemStand;
    this.#domainEventBus = domainEventBus;
    this.#systemEventBus = systemEventBus;
    this.#registry = registry;
  }

  /**
   * Starts immediate and ten-second complete-snapshot reconciliation.
   */
  start(): void {
    if (this.#timer !== undefined || this.#closing) return;
    // spine-log-boundary: server.subscription_initial_reconcile
    void this.reconcile().catch(() => {
      this.#warnReconciliationFailure();
    });
    this.#timer = setInterval(() => {
      void this.#reconcileTimer();
    }, 10_000);
    this.#timer.unref();
  }

  /**
   * Adds a local stream consumer and reconciles before returning its handle.
   *
   * @param id Identifies the durable subscription definition.
   * @param onUpdate Receives rendered subscription updates.
   * @returns Resolves to the consumer removal handle.
   */
  consume(id: string, onUpdate: (update: SubscriptionUpdate) => void): Promise<StandSubscription> {
    if (this.#closing) return Promise.reject(new Error("Subscription runtime is closing."));
    let consumers = this.#consumers.get(id);
    if (consumers === undefined) {
      consumers = new Set();
      this.#consumers.set(id, consumers);
    }
    consumers.add(onUpdate);
    return this.reconcile()
      .then(() => this.#consumerHandle(id, onUpdate))
      .catch((error: unknown) => {
        this.#removeConsumer(id, onUpdate);
        throw error;
      });
  }

  /**
   * Updates local attachments from one complete registry snapshot.
   *
   * @returns Resolves after the accepted snapshot is reconciled.
   */
  reconcile(): Promise<void> {
    const cycle = this.#tail.then(async () => {
      if (this.#closing) return;
      await this.#registry.cleanup();
      const entries = await this.#registry.snapshot();
      const seen = new Set<string>();
      for (const entry of entries) {
        const id = entry.subscription.id?.value;
        if (id === undefined) continue;
        seen.add(id);
        if (entry.phase === "active") await this.#attach(id, entry);
        else this.remove(id);
      }
      for (const id of this.#attachments.keys()) if (!seen.has(id)) this.remove(id);
    });
    // spine-log-boundary: server.subscription_reconcile_tail
    this.#tail = cycle.catch(() => undefined);
    return cycle;
  }

  #reconcileTimer(): Promise<void> {
    if (this.#timerReconciliation !== undefined) return this.#timerReconciliation;
    const reconciliation = this.reconcile().finally(() => {
      this.#timerReconciliation = undefined;
    });
    this.#timerReconciliation = reconciliation;
    // spine-log-boundary: server.subscription_timer_reconcile
    void reconciliation.catch(() => {
      this.#warnReconciliationFailure();
    });
    return reconciliation;
  }

  #warnReconciliationFailure(): void {
    const logger = subscriptionRuntimeLoggers.get(this);
    if (logger === undefined) return;
    emitServerWarning(logger, "Subscription reconciliation failed.", {
      operation: "subscription.reconcile",
      reasonCode: "failed",
    });
  }

  /**
   * Removes all local delivery state for one canonical subscription ID.
   *
   * @param id Identifies the durable subscription definition.
   */
  remove(id: string): void {
    this.#consumers.delete(id);
    this.#detach(id);
  }

  #detach(id: string): void {
    const attachment = this.#attachments.get(id);
    if (attachment === undefined) return;
    this.#attachments.delete(id);
    attachment.subscription.unsubscribe();
  }

  /**
   * Returns the pair-owned durable registry.
   *
   * @returns Returns the durable subscription registry.
   */
  registry(): StandSubscriptionRegistry {
    return this.#registry;
  }

  /**
   * Marks the runtime terminal and stops its reconciliation timer.
   */
  beginClose(): void {
    this.#closing = true;
    if (this.#timer !== undefined) clearInterval(this.#timer);
  }

  /**
   * Waits for accepted reconciliation and detaches every observer.
   *
   * @returns Resolves after every local observer has been detached.
   */
  async drainClose(): Promise<void> {
    this.beginClose();
    await this.#tail;
    const errors: unknown[] = [];
    for (const id of [...this.#attachments.keys()]) {
      try {
        this.remove(id);
      } catch (error) {
        errors.push(error);
      }
    }
    this.#consumers.clear();
    if (errors.length > 0) throw new AggregateError(errors, "Subscription runtime close failed.");
  }

  /**
   * Closes the shared registry after observer cleanup.
   *
   * @returns Resolves after the durable registry closes.
   */
  finishClose(): Promise<void> {
    this.#closed ??= this.#finishClose();
    return this.#closed;
  }

  async #finishClose(): Promise<void> {
    const errors: unknown[] = [];
    await SubscriptionRuntime.#closePart(() => this.drainClose(), errors);
    await SubscriptionRuntime.#closePart(() => this.#registry.close(), errors);
    if (errors.length > 0) {
      throw new AggregateError(
        errors.flatMap((error) =>
          error instanceof AggregateError
            ? Array.from(error.errors, (nested): unknown => nested)
            : [error],
        ),
        "Subscription runtime close failed.",
      );
    }
  }

  /**
   * Performs all close phases for direct runtime owners.
   *
   * @returns Resolves after runtime shutdown completes.
   */
  close(): Promise<void> {
    return this.finishClose();
  }

  /**
   * Starts failed-construction cleanup before the context has exposed the runtime.
   *
   * @internal
   */
  abortClose(): void {
    this.#closed ??= this.#abortClose();
  }

  async #abortClose(): Promise<void> {
    this.beginClose();
    const registryClose = SubscriptionRuntime.#closeThunk(() => this.#registry.close());
    await Promise.allSettled([this.drainClose(), registryClose]);
  }

  #consumerHandle(id: string, onUpdate: (update: SubscriptionUpdate) => void): StandSubscription {
    let closed = false;
    return Object.freeze({
      get closed() {
        return closed;
      },
      unsubscribe: () => {
        if (closed) return;
        closed = true;
        this.#removeConsumer(id, onUpdate);
      },
    });
  }

  #removeConsumer(id: string, onUpdate: (update: SubscriptionUpdate) => void): void {
    const consumers = this.#consumers.get(id);
    consumers?.delete(onUpdate);
    if (consumers?.size === 0) this.#consumers.delete(id);
  }

  async #attach(id: string, expected: StandSubscriptionEntry): Promise<void> {
    const current = await this.#registry.get(create(SubscriptionIdSchema, { value: id }));
    if (current?.phase !== "active" || !sameEntry(current, expected) || this.#closing) return;
    const identity = entryIdentity(current);
    if (sameBytes(this.#attachments.get(id)?.identity, identity)) return;
    this.#detach(id);
    const state = standAccess.observedState(
      this.#domainStand,
      current.subscription.topic?.target?.type,
    );
    const attachment =
      state === undefined
        ? SubscriptionObservers.observeEvent(
            current.subscription,
            this.#domainEventBus,
            (update) => {
              this.#notify(id, update);
            },
          )
        : standAccess.observeState(
            this.#systemStand,
            current.subscription,
            state,
            this.#systemEventBus,
            (update) => {
              this.#notify(id, update);
            },
          );
    if (attachment !== undefined) this.#attachments.set(id, { identity, subscription: attachment });
  }

  static async #closePart(work: () => Promise<void>, errors: unknown[]): Promise<void> {
    try {
      await work();
    } catch (error) {
      errors.push(error);
    }
  }

  static async #closeThunk(work: () => Promise<void>): Promise<void> {
    await work();
  }

  #notify(id: string, update: SubscriptionUpdate): void {
    for (const consumer of [...(this.#consumers.get(id) ?? [])]) {
      const logger = subscriptionRuntimeLoggers.get(this);
      try {
        const invoke: (next: SubscriptionUpdate) => unknown = consumer;
        const outcome = invoke(update);
        if (SubscriptionRuntime.#isPromiseLike(outcome)) {
          // spine-log-boundary: server.subscription_consumer_async_delivery
          void Promise.resolve(outcome).catch(() => {
            SubscriptionRuntime.#warnConsumerFailure(logger, id);
          });
        }
        // spine-log-boundary: server.subscription_consumer_delivery
      } catch {
        // Individual best-effort stream consumers cannot suppress peers.
        SubscriptionRuntime.#warnConsumerFailure(logger, id);
      }
    }
  }

  static #warnConsumerFailure(logger: ILogLayer | undefined, id: string): void {
    if (logger === undefined) return;
    emitServerWarning(logger, "Subscription consumer delivery failed.", {
      subscriptionId: id,
      operation: "subscription.consumer",
      reasonCode: "failed",
    });
  }

  static #isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return (
      (typeof value === "object" || typeof value === "function") &&
      value !== null &&
      "then" in value &&
      typeof (value as { then?: unknown }).then === "function"
    );
  }
}

/**
 * Exposes framework-only subscription-runtime logging metadata installation.
 *
 * @internal
 */
export const subscriptionRuntimeAccess: SubscriptionRuntimeAccess = Object.freeze({
  installLogger(runtime: SubscriptionRuntime, logger: ILogLayer): void {
    if (!subscriptionRuntimes.has(runtime)) {
      throw new TypeError("Subscription runtime logger requires a SubscriptionRuntime instance.");
    }
    subscriptionRuntimeLoggers.set(runtime, logger);
  },
  clearLogger(runtime: SubscriptionRuntime): void {
    if (!subscriptionRuntimes.has(runtime)) {
      throw new TypeError("Subscription runtime logger requires a SubscriptionRuntime instance.");
    }
    subscriptionRuntimeLoggers.delete(runtime);
  },
  loggerFor(runtime: SubscriptionRuntime): ILogLayer {
    if (!subscriptionRuntimes.has(runtime)) {
      throw new TypeError("Subscription runtime logger requires a SubscriptionRuntime instance.");
    }
    const logger = subscriptionRuntimeLoggers.get(runtime);
    if (logger === undefined) throw new TypeError("Subscription runtime logger is not installed.");
    return logger;
  },
});

function entryIdentity(entry: StandSubscriptionEntry): Uint8Array {
  const subscription = toBinary(SubscriptionSchema, entry.subscription);
  const createdAt = new Uint8Array(8);
  new DataView(createdAt.buffer).setFloat64(0, entry.createdAt);
  const identity = new Uint8Array(subscription.length + createdAt.length);
  identity.set(subscription);
  identity.set(createdAt, subscription.length);
  return identity;
}

function sameEntry(left: StandSubscriptionEntry, right: StandSubscriptionEntry): boolean {
  return (
    left.phase === right.phase &&
    left.createdAt === right.createdAt &&
    sameBytes(entryIdentity(left), entryIdentity(right))
  );
}

function sameBytes(left: Uint8Array | undefined, right: Uint8Array): boolean {
  return left?.length === right.length && left.every((value, index) => value === right[index]);
}
