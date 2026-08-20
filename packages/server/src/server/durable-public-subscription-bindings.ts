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

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  GatewayPublicSubscriptionSchema,
  type GatewayPublicSubscription,
} from "@spine-event-engine/proto/auth";
import { SubscriptionIdSchema, SubscriptionSchema, TopicSchema, type SubscriptionId } from "@spine-event-engine/proto/client";
import type {
  OnSubscriptionDefinition,
  PublicSubscriptionWire,
  SubscriptionBindingTransition,
  SubscriptionBindings,
  SubscriptionTopicWire,
} from "@spine-event-engine/auth";
import { RecordSpec, type RecordStorage, type StorageFactory } from "@spine-event-engine/storage";
import type { ActorContext } from "@spine-event-engine/proto";

const cleanupPageSize = 25;
interface PublicCleanupState {
  readonly caller: OnSubscriptionDefinition;
  backend: OnSubscriptionDefinition | undefined;
}
const publicCleanupStates = new WeakMap<DurablePublicSubscriptionBindings, PublicCleanupState>();

/** Configures a durable public orphan-cleanup ledger. */
export interface DurablePublicSubscriptionBindingsOptions {
  /** Stores approved public subscription records. */
  readonly storageFactory: StorageFactory;
  /** Names the Gateway storage context. */
  readonly namespace: string;
  /** Returns the next public subscription identifier. */
  readonly nextId: () => string;
  /** Removes one backend subscription during graceful cleanup. */
  readonly cleanup: OnSubscriptionDefinition;
}

/**
 * Persists public Gateway definitions only until native cancellation succeeds.
 *
 * This ledger never rehydrates public subscriptions: surviving rows represent
 * definitions left behind by an abrupt Gateway loss and are cancelled on the
 * next standalone Gateway startup.
 */
export class DurablePublicSubscriptionBindings implements SubscriptionBindings {
  /** Names the Gateway storage context. */
  readonly namespace: string;
  readonly #storage: RecordStorage<SubscriptionId, GatewayPublicSubscription>;
  readonly #nextId: () => string;
  readonly #pending = new Map<string, Promise<unknown>>();
  readonly #active = new Map<string, AbortController>();
  #closed = false;
  #accepting = true;
  #closing: Promise<void> | undefined;

  /** Opens a public cleanup ledger without taking ownership of the storage factory. */
  constructor(options: DurablePublicSubscriptionBindingsOptions) {
    if (options.namespace.trim().length === 0)
      throw new Error("Gateway namespace must be non-blank.");
    this.namespace = options.namespace;
    this.#nextId = options.nextId;
    publicCleanupStates.set(this, { caller: options.cleanup, backend: undefined });
    this.#storage = options.storageFactory.createRecordStorage(
      { name: `spine.auth.public.${options.namespace}`, multitenant: false },
      new RecordSpec({
        recordType: GatewayPublicSubscriptionSchema,
        idSchema: SubscriptionIdSchema,
        extractId: (record) => {
          if (record.id === undefined) throw new Error("Public subscription has no ID.");
          return record.id;
        },
      }),
    );
    if (!this.#storage.atomicCompareAndSet) {
      this.#storage.close();
      throw new Error("Public subscription storage requires atomic compare-and-set.");
    }
  }

  /** Creates a durable orphan-cleanup record before native subscription admission. */
  create(input: { readonly topic: SubscriptionTopicWire }): Promise<PublicSubscriptionWire> {
    return this.#forId(this.#nextId(), async (id) => {
      const topic = fromBinary(TopicSchema, input.topic.bytes);
      if (topic.context === undefined) throw new Error("Public subscription topic has no trusted context.");
      const subscription = create(SubscriptionSchema, { id: create(SubscriptionIdSchema, { value: id }), topic });
      const record = create(GatewayPublicSubscriptionSchema, {
        id: create(SubscriptionIdSchema, { value: id }),
        subscription,
      });
      const recordId = record.id;
      if (recordId === undefined) throw new Error("Public subscription has no ID.");
      if (!(await this.#storage.compareAndSet(recordId, undefined, record)))
        throw new Error("subscription ID must be unique");
      return PublicSubscriptionValues.wire(record);
    });
  }

  /** Activates an extant public definition. */
  activate(input: {
    readonly id: string;
    readonly context: ActorContext;
    readonly nowMs: number;
    readonly onDefinition: OnSubscriptionDefinition;
    readonly signal: AbortSignal;
  }): Promise<SubscriptionBindingTransition> {
    return this.#forId(input.id, async () => {
      const definition = await this.#wire(input.id);
      if (input.signal.aborted || definition === undefined) return { kind: "denied" };
      const controller = new AbortController();
      const abort = () => controller.abort();
      input.signal.addEventListener("abort", abort, { once: true });
      if (input.signal.aborted) controller.abort();
      this.#active.set(input.id, controller);
      try {
        await input.onDefinition(definition, controller.signal);
      } finally {
        input.signal.removeEventListener("abort", abort);
        if (this.#active.get(input.id) === controller) this.#active.delete(input.id);
      }
      return { kind: "activated" };
    });
  }

  /** Cancels the native definition and deletes its ledger row only on success. */
  cancel(input: {
    readonly id: string;
    readonly context: ActorContext;
    readonly nowMs: number;
    readonly onDefinition: OnSubscriptionDefinition;
  }): Promise<SubscriptionBindingTransition> {
    this.#active.get(input.id)?.abort();
    return this.#forId(input.id, async () => {
      const record = await this.#read(input.id);
      if (record === undefined) return { kind: "closed" };
      await input.onDefinition(PublicSubscriptionValues.wire(record), new AbortController().signal);
      const id = record.id;
      if (id === undefined) throw new Error("Public subscription has no ID.");
      if (await this.#storage.compareAndSet(id, record, undefined)) return { kind: "closed" };
      return (await this.#storage.read(id)) === undefined ? { kind: "closed" } : { kind: "denied" };
    });
  }

  /** Public definitions never expire. */
  purgeExpired(_nowMs: number): Promise<void> {
    return Promise.resolve();
  }

  /** Cancels and deletes every orphaned native definition in bounded storage pages. */
  async cleanupOrphans(cleanup: OnSubscriptionDefinition = publicCleanupFor(this)): Promise<void> {
    this.#open(this.#closing !== undefined);
    let after: { readonly id: SubscriptionId; readonly values: readonly [{ readonly field: "id"; readonly value: SubscriptionId }] } | undefined;
    for (;;) {
      const page = await this.#storage.queryEntries({
        sort: [{ field: "id" }], limit: cleanupPageSize, ...(after === undefined ? {} : { after }),
      });
      if (page.length === 0) return;
      for (const { id, record } of page) await this.#forId(id.value, async () => {
        const current = await this.#storage.read(id);
        if (current === undefined) return;
        await cleanup(PublicSubscriptionValues.wire(current), new AbortController().signal);
        await this.#storage.compareAndSet(id, current, undefined);
      }, true);
      const last = page.at(-1);
      if (last === undefined) throw new Error("Public subscription cleanup page is invalid.");
      after = { id: last.id, values: [{ field: "id", value: last.id }] };
    }
  }

  /** Gracefully removes backend definitions before closing the ledger. */
  close(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#accepting = false;
    if (this.#closing === undefined) {
      let resolveStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
      this.#closing = started.then(() => this.#close());
      resolveStarted?.();
    }
    return this.#closing;
  }

  async #close(): Promise<void> {
    for (const controller of this.#active.values()) controller.abort();
    try {
      await this.cleanupOrphans();
      this.#closed = true;
      this.#storage.close();
    } finally {
      if (!this.#closed) this.#closing = undefined;
    }
  }

  /** Closes storage after failed startup without retrying orphan cleanup. @internal */
  abandon(): void {
    if (this.#closed) return;
    for (const controller of this.#active.values()) controller.abort();
    this.#closed = true;
    this.#storage.close();
  }

  async #read(id: string): Promise<GatewayPublicSubscription | undefined> {
    if (id.length === 0) return undefined;
    return this.#storage.read(create(SubscriptionIdSchema, { value: id }));
  }

  async #wire(id: string): Promise<PublicSubscriptionWire | undefined> {
    const record = await this.#read(id);
    return record === undefined ? undefined : PublicSubscriptionValues.wire(record);
  }

  async #forId<T>(id: string, operation: (id: string) => Promise<T>, closing = false): Promise<T> {
    this.#open(closing);
    if (id.trim().length === 0) throw new Error("subscription ID must be non-blank");
    const previous = this.#pending.get(id) ?? Promise.resolve();
    const task = previous.then(() => operation(id), () => operation(id));
    this.#pending.set(id, task);
    try { return await task; } finally { if (this.#pending.get(id) === task) this.#pending.delete(id); }
  }

  #open(closing = false): void {
    if (this.#closed || (!closing && !this.#accepting))
      throw new Error("public subscription store is closed");
  }
}

/** Checks whether bindings use the durable public orphan-cleanup ledger. */
export function isDurablePublicSubscriptionBindings(
  bindings: SubscriptionBindings | undefined,
): bindings is DurablePublicSubscriptionBindings {
  return bindings instanceof DurablePublicSubscriptionBindings;
}

/** Attaches BrowserServer native cancellation to public ledger cleanup. */
export function attachDurablePublicSubscriptionCleanup(
  bindings: DurablePublicSubscriptionBindings,
  cleanup: OnSubscriptionDefinition,
): void {
  const state = publicCleanupStates.get(bindings);
  if (state === undefined) throw new Error("Public subscription cleanup state is unavailable.");
  if (state.backend !== undefined) throw new Error("Public subscription cleanup is already attached.");
  state.backend = cleanup;
}

function publicCleanupFor(bindings: DurablePublicSubscriptionBindings): OnSubscriptionDefinition {
  const state = publicCleanupStates.get(bindings);
  if (state === undefined) throw new Error("Public subscription cleanup state is unavailable.");
  return async (definition, signal) => {
    if (state.backend !== undefined) await state.backend(definition, signal);
    await state.caller(definition, signal);
  };
}

const PublicSubscriptionValues = Object.freeze({
  wire(record: GatewayPublicSubscription): PublicSubscriptionWire {
    if (record.subscription === undefined) throw new Error("Public subscription has no definition.");
    return { kind: "public-subscription", bytes: toBinary(SubscriptionSchema, record.subscription) };
  },
});
