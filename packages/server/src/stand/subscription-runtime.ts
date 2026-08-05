import { create } from "@bufbuild/protobuf";
import { SubscriptionIdSchema, type SubscriptionUpdate } from "@spine-event-engine/proto/client";

import type { EventBus } from "../bus/event-bus.js";
import { SubscriptionObservers, type StandObservedState } from "./subscription-observer.js";
import { standAccess, type Stand, type StandSubscription } from "./stand.js";
import type { StandSubscriptionRegistry } from "./subscription-registry.js";

interface LocalSubscriptionAttachment {
  readonly revision: bigint;
  readonly subscription: StandSubscription;
}

/**
 * Coordinates the local delivery side of one paired bounded context's durable
 * subscription registry.
 *
 * The runtime owns exactly one registry snapshot loop, timer, attachment map,
 * and consumer map. It classifies a target from domain Stand metadata before
 * attaching it: domain events observe only the domain bus, while entity-state
 * updates observe only the paired System bus. This keeps a subscription ID and
 * revision attached once, while allowing all active service streams to share
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
  #closing = false;

  /**
   * Creates an unstarted runtime for a paired domain and System Stand.
   *
   * @param domainStand Supplies authoritative domain state metadata.
   * @param systemStand Retained as the paired state-observer owner boundary.
   * @param domainEventBus Delivers domain-event subscription targets.
   * @param systemEventBus Delivers `EntityStateChanged` subscription targets.
   * @param registry Stores canonical subscription definitions in the domain namespace.
   */
  constructor(
    domainStand: Stand,
    systemStand: Stand,
    domainEventBus: EventBus,
    systemEventBus: EventBus,
    registry: StandSubscriptionRegistry,
  ) {
    this.#domainStand = domainStand;
    this.#systemStand = systemStand;
    this.#domainEventBus = domainEventBus;
    this.#systemEventBus = systemEventBus;
    this.#registry = registry;
  }

  /** Starts immediate and ten-second complete-snapshot reconciliation. */
  start(): void {
    if (this.#timer !== undefined || this.#closing) return;
    void this.reconcile().catch(() => undefined);
    this.#timer = setInterval(() => void this.reconcile().catch(() => undefined), 10_000);
    this.#timer.unref();
  }

  /** Adds a local stream consumer and reconciles before returning its handle. */
  consume(id: string, onUpdate: (update: SubscriptionUpdate) => void): Promise<StandSubscription> {
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

  /** Runs one complete registry snapshot for explicit convergence and tests. */
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
        if (entry.phase === "active") await this.#attach(id, entry.revision);
        else this.remove(id);
      }
      for (const id of this.#attachments.keys()) if (!seen.has(id)) this.remove(id);
    });
    this.#tail = cycle.catch(() => undefined);
    return cycle;
  }

  /** Removes all local delivery state for one canonical subscription ID. */
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

  /** Returns the pair-owned durable registry. */
  registry(): StandSubscriptionRegistry {
    return this.#registry;
  }

  /** Stops new reconciliation and detaches local observers. */
  async close(): Promise<void> {
    this.#closing = true;
    if (this.#timer !== undefined) clearInterval(this.#timer);
    await this.#tail;
    for (const id of [...this.#attachments.keys()]) this.remove(id);
    this.#consumers.clear();
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

  async #attach(id: string, revision: bigint): Promise<void> {
    const current = await this.#registry.get(create(SubscriptionIdSchema, { value: id }));
    if (current?.phase !== "active" || current.revision !== revision || this.#closing) return;
    if (this.#attachments.get(id)?.revision === revision) return;
    this.#detach(id);
    const state = standAccess.observedState(this.#domainStand, current.subscription.topic?.target?.type);
    const attachment =
      state === undefined
        ? SubscriptionObservers.observeEvent(current.subscription as never, this.#domainEventBus, (update) =>
            this.#notify(id, update),
          )
        : SubscriptionObservers.observeState(current.subscription as never, state, this.#systemEventBus, (update) =>
            this.#notify(id, update),
          );
    // Keep the paired Stand an explicit construction dependency. It owns no
    // copied domain metadata and is the System-side observer boundary.
    void this.#systemStand;
    if (attachment !== undefined) this.#attachments.set(id, { revision, subscription: attachment });
  }

  #notify(id: string, update: SubscriptionUpdate): void {
    for (const consumer of [...(this.#consumers.get(id) ?? [])]) {
      try {
        consumer(update);
      } catch {
        // Individual best-effort stream consumers cannot suppress peers.
      }
    }
  }
}
