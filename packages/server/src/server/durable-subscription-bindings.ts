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

import { clone, create, fromBinary, ScalarType, toBinary } from "@bufbuild/protobuf";
import { timestampFromMs, type Timestamp } from "@bufbuild/protobuf/wkt";
import {
  GatewayAuthenticatedSubscriptionSchema,
  type GatewayAuthenticatedSubscription,
} from "@spine-event-engine/proto/auth";
import {
  SubscriptionIdSchema,
  SubscriptionSchema,
  TopicSchema,
  type SubscriptionId,
} from "@spine-event-engine/proto/client";
import { TenantIdSchema, type ActorContext } from "@spine-event-engine/proto";
import type {
  OnSubscriptionDefinition,
  PublicSubscriptionWire,
  SubscriptionTopicWire,
  SubscriptionBindingTransition,
  SubscriptionBindings,
  SubscriptionGatewayLimits,
} from "@spine-event-engine/auth";
import {
  ColumnTypes,
  RecordColumn,
  RecordSpec,
  type RecordStorage,
  type StorageFactory,
} from "@spine-event-engine/storage";

const expiryBatchSize = 25;
interface DurableCleanupState {
  readonly caller: OnSubscriptionDefinition;
  backend: OnSubscriptionDefinition | undefined;
}

const durableCleanupStates = new WeakMap<DurableSubscriptionBindings, DurableCleanupState>();

/**
 * Configures one durable authenticated subscription store.
 */
export interface DurableSubscriptionBindingsOptions {
  // prettier-ignore

  /**
   * Stores approved authenticated subscription records.
   */
  readonly storageFactory: StorageFactory;

  /**
   * Names the Gateway storage context.
   */
  readonly namespace: string;

  /**
   * Returns the next public subscription identifier.
   *
   * @returns A unique Subscription ID value.
   */
  readonly nextId: () => string;

  /**
   * Removes one backend subscription during expiry or close.
   */
  readonly cleanup: OnSubscriptionDefinition;

  /**
   * Limits one local per-ID operation queue.
   */
  readonly limits?: Pick<
    SubscriptionGatewayLimits,
    "pendingOperationLimit" | "operationTimeoutMs" | "shutdownTimeoutMs"
  >;
}

/**
 * Persists the approved authenticated subscription message directly.
 *
 * This handle serializes only operations for a single ID in this Gateway
 * process. It intentionally does not coordinate multiple Gateway processes.
 */
export class DurableSubscriptionBindings implements SubscriptionBindings {
  // prettier-ignore

  /**
   * Names the Gateway storage context.
   */
  readonly namespace: string;
  readonly #storage: RecordStorage<SubscriptionId, GatewayAuthenticatedSubscription>;
  readonly #nextId: () => string;
  readonly #pending = new Map<string, Promise<unknown>>();
  readonly #active = new Map<string, AbortController>();
  readonly #limits: Required<
    Pick<
      SubscriptionGatewayLimits,
      "pendingOperationLimit" | "operationTimeoutMs" | "shutdownTimeoutMs"
    >
  >;
  readonly #queued = new Map<string, number>();
  readonly #running = new Set<Promise<unknown>>();
  #purgeHorizon: number | undefined;
  #purging: Promise<void> | undefined;
  #closed = false;
  #closing: Promise<void> | undefined;

  /**
   * Opens a durable store without taking ownership of the supplied factory.
   *
   * @param options Supplies storage, identity allocation, and backend cleanup.
   */
  constructor(options: DurableSubscriptionBindingsOptions) {
    if (options.namespace.trim().length === 0)
      throw new Error("Gateway namespace must be non-blank.");
    this.namespace = options.namespace;
    durableCleanupStates.set(this, { caller: options.cleanup, backend: undefined });
    this.#limits = {
      pendingOperationLimit: 1,
      operationTimeoutMs: 30_000,
      shutdownTimeoutMs: 1_000,
      ...options.limits,
    };
    for (const limit of Object.values(this.#limits))
      if (!Number.isSafeInteger(limit) || limit <= 0)
        throw new Error("subscription limits must be positive safe integers");
    this.#nextId = options.nextId;
    this.#storage = options.storageFactory.createRecordStorage(
      { name: `spine.auth.${options.namespace}`, multitenant: false },
      new RecordSpec({
        recordType: GatewayAuthenticatedSubscriptionSchema,
        idSchema: SubscriptionIdSchema,
        extractId: (record) => {
          if (record.id === undefined) throw new Error("Authenticated subscription has no ID.");
          return record.id;
        },
        columns: [
          new RecordColumn("when_expires", ColumnTypes.scalar(ScalarType.INT64), (record) =>
            DurableSubscriptionValues.expiryMs(record.whenExpires),
          ),
        ],
      }),
    );
    if (!this.#storage.atomicCompareAndSet) {
      this.#storage.close();
      throw new Error("Authenticated subscription storage requires atomic compare-and-set.");
    }
  }

  /**
   * Creates one inactive authenticated subscription from a trusted topic.
   * @param input Supplies the trusted topic and expiry.
   * @returns The stored public subscription definition.
   */
  create(input: {
    readonly topic: SubscriptionTopicWire;
    readonly whenExpires: number;
  }): Promise<PublicSubscriptionWire> {
    return this.#admit(() => this.#create(input));
  }

  async #create(input: {
    readonly topic: SubscriptionTopicWire;
    readonly whenExpires: number;
  }): Promise<PublicSubscriptionWire> {
    const id = this.#nextId();
    if (id.trim().length === 0) throw new Error("subscription ID must be non-blank");
    const topic = fromBinary(TopicSchema, input.topic.bytes);
    if (topic.context === undefined)
      throw new Error("Authenticated subscription topic has no trusted context.");
    const subscription = create(SubscriptionSchema, {
      id: create(SubscriptionIdSchema, { value: id }),
      topic,
    });
    const record = create(GatewayAuthenticatedSubscriptionSchema, {
      id: create(SubscriptionIdSchema, { value: id }),
      subscription: clone(SubscriptionSchema, subscription),
      whenExpires: timestampFromMs(input.whenExpires),
    });
    DurableSubscriptionValues.validate(record);
    const recordId = record.id;
    if (recordId === undefined) throw new Error("Authenticated subscription has no ID.");
    let applied: boolean;
    try {
      applied = await this.#storage.compareAndSet(recordId, undefined, record);
    } catch (error) {
      const current = await this.#storage.read(recordId);
      if (current !== undefined && DurableSubscriptionValues.same(current, record))
        return DurableSubscriptionValues.wire(record);
      throw error;
    }
    if (!applied) {
      const current = await this.#storage.read(recordId);
      if (current === undefined || !DurableSubscriptionValues.same(current, record))
        throw new Error("subscription ID must be unique");
    }
    return DurableSubscriptionValues.wire(record);
  }

  /**
   * Activates a retained definition after checking its exact authenticated context.
   *
   * @param input Supplies the retained ID, authenticated context, clock, callback, and cancellation signal.
   * @returns The activation outcome.
   */
  activate(input: {
    readonly id: string;
    readonly context: ActorContext;
    readonly nowMs: number;
    readonly onDefinition: OnSubscriptionDefinition;
    readonly signal: AbortSignal;
  }): Promise<SubscriptionBindingTransition> {
    return this.#forId(input.id, async () => {
      if (input.signal.aborted) return { kind: "denied" };
      const record = await this.#read(input.id);
      if (
        record === undefined ||
        this.#expired(record, input.nowMs) ||
        !DurableSubscriptionValues.owns(record, input.context)
      )
        return { kind: "denied" };
      await this.#callbackForId(
        input.id,
        input.onDefinition,
        DurableSubscriptionValues.wire(record),
        input.signal,
        true,
      );
      return { kind: "activated" };
    });
  }

  /**
   * Removes a retained definition only after backend cleanup succeeds.
   *
   * @param input Supplies the retained ID, authenticated context, clock, and cleanup callback.
   * @returns The cancellation outcome.
   */
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
      if (
        this.#expired(record, input.nowMs) ||
        !DurableSubscriptionValues.owns(record, input.context)
      )
        return { kind: "denied" };
      await this.#callbackForId(
        input.id,
        input.onDefinition,
        DurableSubscriptionValues.wire(record),
      );
      const recordId = record.id;
      if (recordId === undefined) throw new Error("Authenticated subscription has no ID.");
      if (await this.#storage.compareAndSet(recordId, record, undefined)) return { kind: "closed" };
      return (await this.#storage.read(recordId)) === undefined
        ? { kind: "closed" }
        : { kind: "denied" };
    });
  }

  /**
   * Removes at most the earliest 25 expired definitions.
   *
   * @param nowMs Supplies the current epoch milliseconds.
   * @returns A completion result after the bounded cleanup pass.
   */
  purgeExpired(nowMs: number): Promise<void> {
    try {
      this.#open();
    } catch {
      return Promise.reject(new Error("authenticated subscription store is closed"));
    }
    this.#purgeHorizon = Math.max(this.#purgeHorizon ?? nowMs, nowMs);
    if (this.#purging !== undefined) return this.#purging;
    const task = this.#drainPurges();
    this.#purging = task;
    this.#track(task);
    void task.then(
      () => {
        if (this.#purging === task) this.#purging = undefined;
      },
      () => {
        if (this.#purging === task) this.#purging = undefined;
      },
    );
    return task;
  }

  async #drainPurges(): Promise<void> {
    while (this.#purgeHorizon !== undefined) {
      const horizon = this.#purgeHorizon;
      this.#purgeHorizon = undefined;
      await this.#purgeExpired(horizon);
    }
  }

  async #purgeExpired(nowMs: number): Promise<void> {
    const records = await this.#storage.queryEntries({
      sort: [{ field: "when_expires" }, { field: "id" }],
      limit: expiryBatchSize,
    });
    for (const { id: slotId, record } of records) {
      DurableSubscriptionValues.validate(record, slotId);
      if (!this.#expired(record, nowMs)) break;
      const id = slotId.value;
      this.#active.get(id)?.abort();
      await this.#forId(id, () => this.#removeExpired(record), true);
    }
  }

  /**
   * Restores every unexpired durable definition and removes expired rows.
   *
   * @param input Supplies the current epoch milliseconds and rehydration callback.
   * @returns A completion result after recovery.
   */
  recoverActive(input: {
    readonly nowMs: number;
    readonly onDefinition: (
      definition: PublicSubscriptionWire,
      whenExpires: number,
    ) => Promise<void>;
  }): Promise<void> {
    return this.#admit(() => this.#recoverActive(input));
  }

  async #recoverActive(input: {
    readonly nowMs: number;
    readonly onDefinition: (
      definition: PublicSubscriptionWire,
      whenExpires: number,
    ) => Promise<void>;
  }): Promise<void> {
    let after:
      | {
          readonly id: SubscriptionId;
          readonly values: readonly [{ readonly field: "id"; readonly value: SubscriptionId }];
        }
      | undefined;
    for (;;) {
      const page = await this.#storage.queryEntries({
        sort: [{ field: "id" }],
        limit: expiryBatchSize,
        ...(after === undefined ? {} : { after }),
      });
      if (page.length === 0) return;
      for (const { id: slotId, record } of page) {
        DurableSubscriptionValues.validate(record, slotId);
        const id = slotId.value;
        await this.#forId(
          id,
          async () => {
            if (this.#expired(record, input.nowMs)) await this.#removeExpired(record);
            else
              await input.onDefinition(
                DurableSubscriptionValues.wire(record),
                DurableSubscriptionValues.expiryMs(record.whenExpires),
              );
          },
          true,
        );
      }
      const last = page.at(-1);
      if (last === undefined)
        throw new Error("Authenticated subscription recovery page is invalid.");
      after = { id: last.id, values: [{ field: "id", value: last.id }] };
    }
  }

  /**
   * Stops local operations while leaving durable rows for the next Gateway.
   *
   * @returns A completion result after local operations settle and storage closes.
   */
  close(): Promise<void> {
    this.#closing ??= this.#close();
    return this.#closing;
  }

  async #close(): Promise<void> {
    this.#closed = true;
    for (const controller of this.#active.values()) controller.abort();
    const joined = Promise.allSettled([...this.#running]);
    let rejectTimeout: (error: Error) => void = () => undefined;
    const limit = new Promise<never>((_, onReject: (error: Error) => void) => {
      rejectTimeout = onReject;
    });
    const timeout = setTimeout(() => {
      rejectTimeout(new Error("subscription shutdown timed out"));
    }, this.#limits.shutdownTimeoutMs);
    try {
      await Promise.race([joined, limit]);
    } finally {
      clearTimeout(timeout);
      this.#storage.close();
    }
  }

  async #removeExpired(record: GatewayAuthenticatedSubscription): Promise<void> {
    try {
      const id = record.id?.value;
      if (id === undefined) throw new Error("Authenticated subscription has no ID.");
      await this.#callbackForId(
        id,
        durableCleanupFor(this),
        DurableSubscriptionValues.wire(record),
      );
    } catch {
      return;
    }
    if (record.id !== undefined) await this.#storage.compareAndSet(record.id, record, undefined);
  }

  async #read(id: string): Promise<GatewayAuthenticatedSubscription | undefined> {
    if (id.length === 0) return undefined;
    const record = await this.#storage.read(create(SubscriptionIdSchema, { value: id }));
    if (record !== undefined)
      DurableSubscriptionValues.validate(record, create(SubscriptionIdSchema, { value: id }));
    return record;
  }

  #expired(record: GatewayAuthenticatedSubscription, nowMs: number): boolean {
    DurableSubscriptionValues.validate(record);
    return DurableSubscriptionValues.expiryMs(record.whenExpires) <= nowMs;
  }

  async #forId<T>(id: string, operation: () => Promise<T>, admitted = false): Promise<T> {
    if (!admitted) this.#open();
    const previous = this.#pending.get(id) ?? Promise.resolve();
    const queued = this.#queued.get(id) ?? 0;
    const waits = this.#pending.has(id);
    if (waits && queued >= this.#limits.pendingOperationLimit) throw new Error("binding-busy");
    if (waits) this.#queued.set(id, queued + 1);
    const start = () => {
      if (waits) {
        const remaining = (this.#queued.get(id) ?? 1) - 1;
        if (remaining === 0) this.#queued.delete(id);
        else this.#queued.set(id, remaining);
      }
      return operation();
    };
    const task = previous.then(start, start);
    this.#pending.set(id, task);
    this.#track(task);
    try {
      return await task;
    } finally {
      if (this.#pending.get(id) === task) this.#pending.delete(id);
    }
  }

  #admit<T>(operation: () => Promise<T>): Promise<T> {
    try {
      this.#open();
    } catch {
      return Promise.reject(new Error("authenticated subscription store is closed"));
    }
    const task = operation();
    this.#track(task);
    return task;
  }

  #track(task: Promise<unknown>): void {
    this.#running.add(task);
    void task.then(
      () => {
        this.#running.delete(task);
      },
      () => {
        this.#running.delete(task);
      },
    );
  }

  #open(): void {
    if (this.#closed) throw new Error("authenticated subscription store is closed");
  }

  async #callback(
    callback: OnSubscriptionDefinition,
    wire: PublicSubscriptionWire,
    controller: AbortController,
  ): Promise<void> {
    let rejectTimeout: (error: Error) => void = () => undefined;
    const timeout = new Promise<never>((_, onReject: (error: Error) => void) => {
      rejectTimeout = onReject;
    });
    const timer = setTimeout(() => {
      controller.abort();
      rejectTimeout(new Error("subscription operation timed out"));
    }, this.#limits.operationTimeoutMs);
    try {
      await Promise.race([callback(wire, controller.signal), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async #callbackForId(
    id: string,
    callback: OnSubscriptionDefinition,
    wire: PublicSubscriptionWire,
    signal?: AbortSignal,
    active = false,
  ): Promise<void> {
    const controller = new AbortController();
    const abort = () => {
      controller.abort();
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    this.#active.set(id, controller);
    try {
      if (active) await this.#runActiveCallback(callback, wire, controller);
      else await this.#callback(callback, wire, controller);
    } finally {
      signal?.removeEventListener("abort", abort);
      if (this.#active.get(id) === controller) this.#active.delete(id);
    }
  }

  async #runActiveCallback(
    callback: OnSubscriptionDefinition,
    wire: PublicSubscriptionWire,
    controller: AbortController,
  ): Promise<void> {
    let observeAbort = () => undefined;
    const aborted = new Promise<"aborted">((resolve) => {
      observeAbort = () => {
        resolve("aborted");
      };
      controller.signal.addEventListener("abort", observeAbort, { once: true });
    });
    try {
      if (controller.signal.aborted) return;
      const effect = callback(wire, controller.signal);
      const result = await Promise.race([effect.then(() => "settled" as const), aborted]);
      if (result === "settled") return;
    } finally {
      controller.signal.removeEventListener("abort", observeAbort);
    }
  }
}

/**
 * Checks whether bindings use the direct durable authenticated subscription implementation.
 *
 * @param bindings Supplies bindings to check.
 * @returns Whether the bindings are durable authenticated subscription bindings.
 */
export function isDurableSubscriptionBindings(
  bindings: SubscriptionBindings | undefined,
): bindings is DurableSubscriptionBindings {
  return bindings instanceof DurableSubscriptionBindings;
}

/**
 * Attaches BrowserServer cancellation alongside the caller cleanup.
 *
 * @internal
 * @param bindings Durable bindings receiving the internal cancellation effect.
 * @param cleanup BrowserServer backend cancellation callback.
 */
export function attachDurableSubscriptionCleanup(
  bindings: DurableSubscriptionBindings,
  cleanup: OnSubscriptionDefinition,
): void {
  const state = durableCleanupStates.get(bindings);
  if (state === undefined)
    throw new Error("Authenticated subscription cleanup state is unavailable.");
  if (state.backend !== undefined)
    throw new Error("Authenticated subscription cleanup is already attached.");
  state.backend = cleanup;
}

function durableCleanupFor(bindings: DurableSubscriptionBindings): OnSubscriptionDefinition {
  const state = durableCleanupStates.get(bindings);
  if (state === undefined)
    throw new Error("Authenticated subscription cleanup state is unavailable.");
  return async (definition, signal) => {
    if (state.backend !== undefined) await state.backend(definition, signal);
    await state.caller(definition, signal);
  };
}

const DurableSubscriptionValues = Object.freeze({
  expiryMs(timestamp: Timestamp | undefined): number {
    if (timestamp === undefined) return Number.NEGATIVE_INFINITY;
    const seconds = Number(timestamp.seconds);
    const nanos = timestamp.nanos;
    const milliseconds = seconds * 1_000 + Math.floor(nanos / 1_000_000);
    return Number.isSafeInteger(seconds) &&
      Number.isInteger(nanos) &&
      nanos >= 0 &&
      nanos < 1_000_000_000 &&
      Number.isSafeInteger(milliseconds)
      ? milliseconds
      : Number.NEGATIVE_INFINITY;
  },
  wire(record: GatewayAuthenticatedSubscription): PublicSubscriptionWire {
    if (record.subscription === undefined)
      throw new Error("Authenticated subscription has no definition.");
    return {
      kind: "public-subscription",
      bytes: toBinary(SubscriptionSchema, record.subscription),
    };
  },
  same(left: GatewayAuthenticatedSubscription, right: GatewayAuthenticatedSubscription): boolean {
    const first = toBinary(GatewayAuthenticatedSubscriptionSchema, left);
    const second = toBinary(GatewayAuthenticatedSubscriptionSchema, right);
    return (
      first.byteLength === second.byteLength &&
      first.every((value, index) => value === second[index])
    );
  },
  owns(record: GatewayAuthenticatedSubscription, context: ActorContext): boolean {
    const retained = record.subscription?.topic?.context;
    return (
      retained !== undefined &&
      retained.actor?.value === context.actor?.value &&
      DurableSubscriptionValues.tenantsEqual(retained.tenantId, context.tenantId)
    );
  },
  tenantsEqual(left: ActorContext["tenantId"], right: ActorContext["tenantId"]): boolean {
    if (left === undefined || right === undefined) return left === right;
    const first = toBinary(TenantIdSchema, left);
    const second = toBinary(TenantIdSchema, right);
    return (
      first.byteLength === second.byteLength &&
      first.every((value, index) => value === second[index])
    );
  },
  validate(record: GatewayAuthenticatedSubscription, slotId?: SubscriptionId): void {
    const id = record.id?.value;
    const nestedId = record.subscription?.id?.value;
    const context = record.subscription?.topic?.context;
    const expires = record.whenExpires;
    if (
      id === undefined ||
      id.length === 0 ||
      (slotId !== undefined && slotId.value !== id) ||
      nestedId !== id ||
      context?.actor?.value === undefined ||
      DurableSubscriptionValues.expiryMs(expires) === Number.NEGATIVE_INFINITY
    )
      throw new Error("Authenticated subscription record is invalid.");
  },
});
