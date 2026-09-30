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

import { clone, type Message, type MessageShape } from "@bufbuild/protobuf";
import { type MessageSchema, TypeUrls } from "@spine-event-engine/core";
import {
  TenantIdSchema,
  VersionSchema,
  type TenantId,
  type Version,
} from "@spine-event-engine/proto";
import {
  ColumnTypes,
  RecordColumn,
  RecordQuery,
  type NormalizedQueryPlan,
  type StorageContext,
  type StorageMode,
} from "@spine-event-engine/storage";
import { TenantBoundary } from "@spine-event-engine/storage/provider";
import type { StorageFactory } from "@spine-event-engine/storage";
import type { EntityRecordStorage, EntityStorageInput } from "@spine-event-engine/storage/provider";
import type { EntityRecord } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import {
  EntityRecords,
  standEntityStorageDescriptor,
} from "../entity/entity-storage-descriptor.js";
import { SubscriptionObservers, type StandObservedState } from "./subscription-observer.js";
import type { EventBus, EventSubscription } from "../bus/event-bus.js";
import type { Subscription, SubscriptionUpdate } from "@spine-event-engine/proto/client";

const HANDLE_CLOSE_ERROR_LIMIT = 16;

/**
 * Options for constructing a direct read-side Stand.
 */
export interface StandOptions {
  // prettier-ignore

  /**
   * Base storage context owned by the enclosing bounded context.
   */
  readonly context: StorageMode;

  /**
   * Storage factory used for read-side state records.
   */
  readonly storageFactory: StorageFactory;
}

/**
 * Options for registering an entity state schema with the Stand.
 */
export interface StandRegisterOptions {
  // prettier-ignore

  /**
   * Queryable columns materialized for this state type.
   */
  readonly columns?: readonly RecordColumn<Message>[];
}

/**
 * Tenant and version metadata accepted when recording an entity state update.
 */
export interface StandUpdateOptions {
  // prettier-ignore

  /**
   * Tenant slice for multitenant stands.
   */
  readonly tenantId?: TenantId;

  /**
   * Version persisted with the updated state.
   */
  readonly version?: Version;

  /**
   * Durable entity lifecycle. Internal repository callers supply this from the entity transaction.
   */
  readonly lifecycle?: { readonly archived: boolean; readonly deleted: boolean };
}

/**
 * Tenant metadata accepted when reading one entity state.
 */
export interface StandReadOptions {
  // prettier-ignore

  /**
   * Tenant slice for multitenant stands.
   */
  readonly tenantId?: TenantId;
}

/**
 * Stored state plus metadata returned by versioned Stand reads.
 *
 * @typeParam Schema The decoded state message schema.
 */
export interface StandReadResult<Schema extends MessageSchema = MessageSchema> {
  // prettier-ignore

  /**
   * Latest entity state.
   */
  readonly state: MessageShape<Schema>;

  /**
   * Durable version supplied with the latest update.
   */
  readonly version?: Version;
}

/**
 * Tenant metadata accepted when subscribing to entity updates.
 */
export interface StandSubscribeOptions {
  // prettier-ignore

  /**
   * Tenant slice for multitenant stands.
   */
  readonly tenantId?: TenantId;
}

/**
 * Direct in-process entity state update delivered by the Stand.
 *
 * @typeParam Schema The updated state message schema.
 */
export interface StandUpdate<Schema extends MessageSchema = MessageSchema> {
  // prettier-ignore

  /**
   * Type URL of the entity state schema.
   */
  readonly typeUrl: string;

  /**
   * Entity ID extracted from the state.
   */
  readonly id: unknown;

  /**
   * Cloned snapshot of the stored state before this update.
   *
   * Omitted when no previous state existed. Safe for subscribers to retain or
   * mutate after delivery.
   */
  readonly previousState?: MessageShape<Schema>;

  /**
   * Updated entity state.
   */
  readonly state: MessageShape<Schema>;

  /**
   * Version associated with the updated state when supplied.
   */
  readonly version?: Version;

  /**
   * Tenant slice for multitenant stands.
   */
  readonly tenantId?: TenantId;
}

/**
 * Explicit cleanup handle returned by direct Stand subscriptions.
 */
export interface StandSubscription {
  // prettier-ignore

  /**
   * Whether this subscription has already been unsubscribed.
   */
  readonly closed: boolean;

  /**
   * Stops future deliveries. Safe to call more than once.
   */
  unsubscribe(): void;
}

/**
 * Error thrown when direct Stand access targets an unregistered state type.
 */
export class StandStateTypeError extends Error {
  // prettier-ignore

  /**
   * Rejected state type URL.
   */
  readonly typeUrl: string;

  /**
   * Stand operation that required a known state type.
   */
  readonly operation: string;

  /**
   * Creates an error for an operation targeting an unknown state type.
   *
   * @param typeUrl The rejected state type URL.
   * @param operation The operation requiring a registered state type.
   */
  constructor(typeUrl: string, operation: string) {
    super(`Stand cannot ${operation} unknown entity state type "${typeUrl}".`);
    this.name = "StandStateTypeError";
    this.typeUrl = typeUrl;
    this.operation = operation;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * A callback registered for one state schema and tenant.
 *
 * @typeParam Schema State schema.
 */
interface Subscriber<Schema extends MessageSchema = MessageSchema> {
  readonly tenantKey: string;
  readonly callback: (update: StandUpdate<Schema>) => void;
}

/**
 * One state type registered with the Stand.
 *
 * @typeParam Schema State schema.
 */
interface Registration<Schema extends MessageSchema = MessageSchema> {
  readonly schema: Schema;
  readonly typeUrl: string;
  readonly idField: string;
  readonly columns: readonly RecordColumn<Message>[];
  readonly subscribers: Set<Subscriber<Schema>>;
}

/**
 * Direct read-side access point for storage-backed entity states and updates.
 *
 * Entity states are queried through the shared durable current-record seam.
 */
export class Stand {
  readonly #context: StorageMode;

  readonly #storageFactory: StorageFactory;

  readonly #registrations = new Map<string, Registration>();

  readonly #entityHandles = new Map<
    string,
    { readonly current: EntityRecordStorage<unknown>; close(): void }
  >();

  readonly #handleCloseErrors: unknown[] = [];

  #omittedHandleCloseErrors = 0;

  readonly #inFlight = new Set<Promise<void>>();

  #closing = false;

  #closed = false;

  #closedPromise: Promise<void> | undefined;

  /**
   * Creates a direct read-side Stand.
   *
   * @param options The storage context and factory used for state records.
   */
  constructor(options: StandOptions) {
    this.#context = Stand.#cloneContext(options.context);
    this.#storageFactory = options.storageFactory;
    deferredUpdates.set(this, (schema, state, updateOptions) =>
      this.#deferUpdate(schema, state, updateOptions),
    );
    currentReads.set(this, (schema, id, readOptions) => this.#readCurrent(schema, id, readOptions));
  }

  /**
   * Registers one entity state schema. Re-registering the same schema is idempotent.
   *
   * @param schema The entity state schema to register.
   * @param options The materialized columns for the state type.
   */
  register(schema: MessageSchema, options: StandRegisterOptions = {}): void {
    this.#requireOpen();
    const typeUrl = TypeUrls.derive(schema);
    if (this.#registrations.has(typeUrl)) {
      return;
    }

    const idField = schema.fields[0]?.localName;
    if (idField === undefined || idField.trim().length === 0) {
      throw new Error(`Stand state "${schema.typeName}" requires an entity ID field.`);
    }

    this.#registrations.set(
      typeUrl,
      Object.freeze({
        schema,
        typeUrl,
        idField,
        columns:
          options.columns ??
          schema.fields.map(
            (field) =>
              new RecordColumn(
                field.localName,
                ColumnTypes.fromField(field),
                (state) => (state as Record<string, unknown>)[field.localName],
              ),
          ),
        subscribers: new Set<Subscriber>(),
      }),
    );
  }

  /**
   * Returns known state type URLs in registration order.
   *
   * @returns The registered state type URLs.
   */
  stateTypes(): readonly string[] {
    this.#requireOpen();
    return Object.freeze([...this.#registrations.keys()]);
  }

  /**
   * Finds state-observer metadata for one type URL.
   *
   * @param typeUrl Identifies the candidate entity state type.
   * @returns Returns observer metadata when the state is registered.
   * @internal
   */
  observedState(typeUrl: string): StandObservedState | undefined {
    const registration = this.#registrations.get(typeUrl);
    return registration === undefined
      ? undefined
      : Object.freeze({ schema: registration.schema, idField: registration.idField });
  }

  /**
   * Reads the latest state for one entity ID.
   *
   * @typeParam Schema The registered state schema.
   * @param schema The registered entity state schema.
   * @param id The entity ID to read.
   * @param options The tenant slice to read.
   * @returns The latest state, or undefined when no live record exists.
   */
  async read<Schema extends MessageSchema>(
    schema: Schema,
    id: unknown,
    options: StandReadOptions = {},
  ): Promise<MessageShape<Schema> | undefined> {
    const result = await this.readVersioned(schema, id, options);

    return result?.state;
  }

  /**
   * Reads the latest state and its supplied version metadata for one entity ID.
   *
   * @typeParam Schema The registered state schema.
   * @param schema The registered entity state schema.
   * @param id The entity ID to read.
   * @param options The tenant slice to read.
   * @returns The current state and version, or undefined when no live record exists.
   */
  async readVersioned<Schema extends MessageSchema>(
    schema: Schema,
    id: unknown,
    options: StandReadOptions = {},
  ): Promise<StandReadResult<Schema> | undefined> {
    const finish = this.#beginOperation();

    try {
      const registration = this.#registration(schema, "read");
      const tenantId = this.#tenantId(options.tenantId);
      const storage = this.#leaseCurrent(registration, tenantId);
      try {
        const stored = await storage.current.read(id);
        if (stored === undefined || EntityRecords.unpack(registration.schema, stored).deleted) {
          return undefined;
        }
        return this.#currentResult(registration, stored);
      } finally {
        storage.release();
      }
    } finally {
      finish();
    }
  }

  /**
   * Reads all latest states and version metadata in storage query order.
   *
   * @typeParam Schema The registered state schema.
   * @param schema The registered entity state schema.
   * @param options The tenant slice to read.
   * @returns The current states and versions in query order.
   */
  async readAllVersioned<Schema extends MessageSchema>(
    schema: Schema,
    options: StandReadOptions = {},
  ): Promise<readonly StandReadResult<Schema>[]> {
    return this.queryVersioned(schema, {}, options);
  }

  /**
   * Finds latest states and version metadata in storage query order.
   *
   * @typeParam Schema The registered state schema.
   * @param schema The registered entity state schema.
   * @param query The legacy record query to apply.
   * @param options The tenant slice to read.
   * @returns The matching current states and versions.
   */
  async queryVersioned<Schema extends MessageSchema>(
    schema: Schema,
    query: RecordQuery<unknown> = {},
    options: StandReadOptions = {},
  ): Promise<readonly StandReadResult<Schema>[]> {
    const finish = this.#beginOperation();

    try {
      const registration = this.#registration(schema, "read");
      const tenantId = this.#tenantId(options.tenantId);
      const storage = this.#leaseCurrent(registration, tenantId);
      try {
        const stored = await storage.current.query(Stand.#legacyPlan(query));
        const results = stored.map((entry) => this.#entryResult(registration, entry.record));
        return results.filter((result): result is StandReadResult<Schema> => result !== undefined);
      } finally {
        storage.release();
      }
    } finally {
      finish();
    }
  }

  /**
   * Finds latest states through a normalized plan and retains versions.
   *
   * @typeParam Schema The registered state schema.
   * @param schema The registered entity state schema.
   * @param plan The normalized storage query plan to apply.
   * @param options The tenant slice to read.
   * @returns The matching current states and versions.
   */
  async queryPlanVersioned<Schema extends MessageSchema>(
    schema: Schema,
    plan: NormalizedQueryPlan<unknown>,
    options: StandReadOptions = {},
  ): Promise<readonly StandReadResult<Schema>[]> {
    const finish = this.#beginOperation();
    try {
      const registration = this.#registration(schema, "read");
      const tenantId = this.#tenantId(options.tenantId);
      const storage = this.#leaseCurrent(registration, tenantId);
      try {
        const stored = await storage.current.query(plan);
        const results = stored.map((entry) => this.#entryResult(registration, entry.record));
        return results.filter((result): result is StandReadResult<Schema> => result !== undefined);
      } finally {
        storage.release();
      }
    } finally {
      finish();
    }
  }

  /**
   * Clears all stored states and durable version metadata for one known state schema.
   *
   * The legacy-named local `BoundedContext.catchUpReadSide()` reset/replay
   * helper uses this to reset one Projection state type for the selected tenant
   * slice.
   *
   * @param schema The registered entity state schema to clear.
   * @param options The tenant slice to clear.
   * @returns The number of state records marked deleted.
   */
  async clear(schema: MessageSchema, options: StandReadOptions = {}): Promise<number> {
    const finish = this.#beginOperation();

    try {
      const registration = this.#registration(schema, "clear");
      const tenantId = this.#tenantId(options.tenantId);
      const storage = this.#leaseCurrent(registration, tenantId);
      try {
        const entries = await storage.current.query({
          candidateLimit: 10_000,
        });
        const ids = entries.map((entry) => entry.id);
        for (const id of ids) {
          const stored = await storage.current.read(id);
          if (stored !== undefined) {
            const value = EntityRecords.unpack(registration.schema, stored);
            await storage.current.write(
              EntityRecords.pack(registration.schema, id, value.state, value.versionMessage, {
                archived: value.archived,
                deleted: true,
              }),
            );
          }
        }
        return ids.length;
      } finally {
        storage.release();
      }
    } finally {
      finish();
    }
  }

  /**
   * Records one latest entity state and delivers an update to matching subscribers.
   *
   * @typeParam Schema The registered state schema.
   * @param schema The registered entity state schema.
   * @param state The latest entity state to store.
   * @param options The tenant, version, and lifecycle metadata to store.
   * @returns A promise that resolves after the state update is stored.
   */
  async update<Schema extends MessageSchema>(
    schema: Schema,
    state: MessageShape<Schema>,
    options: StandUpdateOptions = {},
  ): Promise<void> {
    const prepared = await this.#prepareUpdate(schema, state, options);
    try {
      await prepared.write();
      prepared.notify();
    } catch (error) {
      prepared.cancel();
      throw error;
    }
  }

  /**
   * Prepares a repository update without notifying subscribers yet.
   *
   * @typeParam Schema The state message schema.
   * @param schema Registered state schema.
   * @param state State to persist.
   * @param options Tenant and version metadata.
   * @returns Deferred write and notification actions.
   */
  async #deferUpdate<Schema extends MessageSchema>(
    schema: Schema,
    state: MessageShape<Schema>,
    options: StandUpdateOptions,
  ): Promise<DeferredStandUpdate> {
    return await this.#prepareUpdate(schema, state, options);
  }

  /**
   * Reserves storage and captures subscribers for one state update.
   *
   * @typeParam Schema The state message schema.
   * @param schema Registered state schema.
   * @param state State to persist.
   * @param options Tenant and version metadata.
   * @returns Prepared write with cleanup actions.
   */
  async #prepareUpdate<Schema extends MessageSchema>(
    schema: Schema,
    state: MessageShape<Schema>,
    options: StandUpdateOptions,
  ): Promise<PreparedStandUpdate> {
    const finish = this.#beginOperation();
    let storage: CurrentStorageLease | undefined;
    try {
      const registration = this.#registration(schema, "update");
      const tenantId = this.#tenantId(options.tenantId);
      const stateCopy = clone(schema, state);
      const id = Stand.#readStateId(stateCopy, registration);
      storage = this.#leaseCurrent(registration, tenantId);
      const currentStorage = storage;
      const previous = this.#hasTenantSubscribers(registration, tenantId)
        ? await currentStorage.current.read(id)
        : undefined;
      const previousState =
        previous === undefined
          ? undefined
          : (EntityRecords.unpack(registration.schema, previous).state as MessageShape<Schema>);
      const subscribers = [...this.#tenantSubscribers(registration, this.#tenantKey(tenantId))];
      const record = EntityRecords.pack(
        registration.schema,
        id,
        stateCopy,
        options.version ?? 0n,
        options.lifecycle ?? { archived: false, deleted: false },
      );
      let settled = false;
      const settle = () => {
        if (!settled) {
          settled = true;
          currentStorage.release();
          finish();
        }
      };
      return Object.freeze({
        cancel: settle,
        write: () => currentStorage.current.write(record),
        notify: () => {
          try {
            this.#notify(
              registration,
              {
                id,
                previousState,
                state: stateCopy,
                tenantId,
                version: options.version,
              },
              subscribers,
            );
          } finally {
            settle();
          }
        },
      });
    } catch (error) {
      storage?.release();
      finish();
      throw error;
    }
  }

  /**
   * Repository-only full current-record read, including lifecycle metadata.
   *
   * @typeParam Schema The registered state schema.
   * @param schema Registered state schema.
   * @param id Entity ID to read.
   * @param options Tenant selection.
   * @returns Current stored state and lifecycle, if present.
   */
  async #readCurrent<Schema extends MessageSchema>(
    schema: Schema,
    id: unknown,
    options: StandReadOptions,
  ): Promise<StandCurrentRecord<Schema> | undefined> {
    const finish = this.#beginOperation();
    try {
      const registration = this.#registration(schema, "read");
      const tenantId = this.#tenantId(options.tenantId);
      const storage = this.#leaseCurrent(registration, tenantId);
      try {
        const stored = await storage.current.read(id);
        if (stored === undefined) return undefined;
        const value = EntityRecords.unpack(registration.schema, stored);
        return Object.freeze({
          state: clone(schema, value.state as MessageShape<Schema>),
          versionMessage: clone(VersionSchema, value.versionMessage),
          version: value.version,
          archived: value.archived,
          deleted: value.deleted,
        });
      } finally {
        storage.release();
      }
    } finally {
      finish();
    }
  }

  /**
   * Subscribes to in-process updates for one registered state schema.
   *
   * @typeParam Schema The registered state schema.
   * @param schema The registered entity state schema.
   * @param callback The function receiving matching state updates.
   * @param options The tenant slice to subscribe to.
   * @returns A handle that stops future callback delivery.
   */
  subscribe<Schema extends MessageSchema>(
    schema: Schema,
    callback: (update: StandUpdate<Schema>) => void,
    options: StandSubscribeOptions = {},
  ): StandSubscription {
    this.#requireOpen();
    const registration = this.#registration(schema, "subscribe");
    const tenantKey = this.#tenantKey(options.tenantId);
    const subscriber: Subscriber<Schema> = Object.freeze({ tenantKey, callback });
    let closed = false;
    registration.subscribers.add(subscriber);

    return Object.freeze({
      get closed() {
        return closed;
      },
      unsubscribe() {
        if (!closed) {
          closed = true;
          registration.subscribers.delete(subscriber);
        }
      },
    });
  }

  /**
   * Closes direct subscriptions and rejects later Stand operations.
   *
   * Close is idempotent. New operations are rejected once close begins, and the
   * close promise waits for already accepted direct reads/updates to finish
   * before clearing subscriptions and version metadata.
   *
   * @returns A promise that settles after the stand closes.
   *
   */
  close(): Promise<void> {
    this.#closedPromise ??= this.#closeOnce();
    return this.#closedPromise;
  }

  async #closeOnce(): Promise<void> {
    this.#closing = true;
    await Promise.all([...this.#inFlight]);
    for (const registration of this.#registrations.values()) {
      registration.subscribers.clear();
    }
    const errors: unknown[] = this.#handleCloseErrors.splice(0);
    let omittedErrors = this.#omittedHandleCloseErrors;
    this.#omittedHandleCloseErrors = 0;
    for (const handle of this.#entityHandles.values()) {
      try {
        handle.close();
      } catch (error) {
        if (errors.length < HANDLE_CLOSE_ERROR_LIMIT) errors.push(error);
        else omittedErrors++;
      }
    }
    this.#entityHandles.clear();
    this.#closed = true;
    if (omittedErrors > 0) {
      errors.push(new Error(`${String(omittedErrors)} additional entity handle close failures.`));
    }
    if (errors.length > 0) throw new AggregateError(errors, "Stand close failed.");
  }

  /**
   * Resolves a registered state type for a Stand operation.
   *
   * @typeParam Schema The requested state schema.
   * @param schema State schema to resolve.
   * @param operation Operation named in an unknown-type error.
   * @returns The matching registration.
   */
  #registration<Schema extends MessageSchema>(
    schema: Schema,
    operation: string,
  ): Registration<Schema> {
    this.#requireOpen();
    const typeUrl = TypeUrls.derive(schema);
    const registration = this.#registrations.get(typeUrl);
    if (registration === undefined) {
      throw new StandStateTypeError(typeUrl, operation);
    }

    return registration as Registration<Schema>;
  }

  #leaseCurrent(registration: Registration, tenantId: TenantId | undefined): CurrentStorageLease {
    if (this.#context.multitenant) {
      return this.#lease(
        Stand.#openStorage(
          this.#storageFactory,
          standEntityStorageDescriptor(
            this.#storageContext(tenantId),
            registration.schema,
            registration.columns,
          ),
        ),
        true,
      );
    }
    const key = registration.typeUrl;
    const existing = this.#entityHandles.get(key);
    if (existing !== undefined) return this.#lease(existing, false);
    const handle = Stand.#openStorage(
      this.#storageFactory,
      standEntityStorageDescriptor(
        this.#storageContext(tenantId),
        registration.schema,
        registration.columns,
      ),
    );
    this.#entityHandles.set(key, handle);
    return this.#lease(handle, false);
  }

  #lease(
    handle: { readonly current: EntityRecordStorage<unknown>; close(): void },
    releaseAfterOperation: boolean,
  ): CurrentStorageLease {
    let released = false;
    return {
      current: handle.current,
      release: () => {
        if (released) return;
        released = true;
        if (releaseAfterOperation) {
          try {
            handle.close();
          } catch (error) {
            if (this.#handleCloseErrors.length < HANDLE_CLOSE_ERROR_LIMIT) {
              this.#handleCloseErrors.push(error);
            } else {
              this.#omittedHandleCloseErrors++;
            }
          }
        }
      },
    };
  }

  /**
   * Decodes a complete current state and its version.
   *
   * @typeParam Schema The decoded state schema.
   * @param registration State registration.
   * @param current Stored Entity record.
   * @returns Current state and version unless deleted.
   */
  #entryResult<Schema extends MessageSchema>(
    registration: Registration<Schema>,
    current: EntityRecord,
  ): StandReadResult<Schema> | undefined {
    const value = EntityRecords.unpack(registration.schema, current);
    if (value.deleted) return undefined;
    const version =
      value.version === 0n && value.versionMessage.timestamp === undefined
        ? undefined
        : value.versionMessage;

    return Object.freeze({
      state: clone(registration.schema, value.state as MessageShape<Schema>),
      ...(version === undefined ? {} : { version: clone(VersionSchema, version) }),
    });
  }

  /**
   * Decodes a complete current record.
   *
   * @typeParam Schema The decoded state schema.
   * @param registration State registration.
   * @param current Stored Entity record.
   * @returns Current state and version unless deleted.
   */
  #currentResult<Schema extends MessageSchema>(
    registration: Registration<Schema>,
    current: EntityRecord,
  ): StandReadResult<Schema> | undefined {
    return this.#entryResult(registration, current);
  }

  /**
   * Delivers one state update to the captured tenant subscribers.
   *
   * @typeParam Schema The updated state schema.
   * @param registration State registration.
   * @param input State and lifecycle details for the notification.
   * @param captured Subscribers captured before persistence, if available.
   */
  #notify<Schema extends MessageSchema>(
    registration: Registration<Schema>,
    input: {
      readonly id: unknown;
      readonly previousState: MessageShape<Schema> | undefined;
      readonly state: MessageShape<Schema>;
      readonly tenantId: TenantId | undefined;
      readonly version: Version | undefined;
    },
    captured?: readonly Subscriber<Schema>[],
  ): void {
    const errors: unknown[] = [];
    const tenantKey = this.#tenantKey(input.tenantId);
    const subscribers = captured ?? this.#tenantSubscribers(registration, tenantKey);

    for (const subscriber of subscribers) {
      try {
        subscriber.callback(Stand.#createUpdate(registration, input));
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, "Stand subscriber delivery failed.");
    }
  }

  #tenantKey(tenantId: TenantId | undefined): string {
    const selected = this.#tenantId(tenantId);
    return selected === undefined ? "__single__" : String(TenantBoundary.from(selected).key);
  }

  #hasTenantSubscribers(registration: Registration, tenantId: TenantId | undefined): boolean {
    const tenantKey = this.#tenantKey(tenantId);

    for (const subscriber of registration.subscribers) {
      if (subscriber.tenantKey === tenantKey) {
        return true;
      }
    }

    return false;
  }

  /**
   * Lists subscribers for the selected state type and tenant.
   *
   * @typeParam Schema The state schema.
   * @param registration State registration.
   * @param tenantKey Tenant key to match.
   * @returns Matching subscribers.
   */
  #tenantSubscribers<Schema extends MessageSchema>(
    registration: Registration<Schema>,
    tenantKey: string,
  ): Subscriber<Schema>[] {
    return [...registration.subscribers].filter((subscriber) => subscriber.tenantKey === tenantKey);
  }

  #tenantId(tenantId: TenantId | undefined): TenantId | undefined {
    if (!this.#context.multitenant) {
      if (tenantId !== undefined) {
        throw new Error(`Single-tenant Stand "${this.#context.name}" does not accept tenantId.`);
      }
      return undefined;
    }

    if (tenantId === undefined) {
      throw new Error(`Multitenant Stand "${this.#context.name}" requires tenantId.`);
    }

    return TenantBoundary.from(tenantId).tenantId;
  }

  #storageContext(tenantId: TenantId | undefined): StorageContext {
    if (!this.#context.multitenant) {
      this.#tenantId(tenantId);
      return Object.freeze({ name: this.#context.name, multitenant: false });
    }
    if (tenantId === undefined) {
      throw new Error(`Multitenant Stand "${this.#context.name}" requires tenantId.`);
    }
    return Object.freeze({
      name: this.#context.name,
      multitenant: true,
      tenantId: TenantBoundary.from(tenantId).tenantId,
    });
  }

  #requireOpen(): void {
    if (this.#closing || this.#closed) {
      throw new Error("Stand is closed.");
    }
  }

  #beginOperation(): () => void {
    this.#requireOpen();
    let finish: (() => void) | undefined;
    const operation = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.#inFlight.add(operation);

    return () => {
      this.#inFlight.delete(operation);
      finish?.();
    };
  }

  /**
   * Clones a state update before delivering it to subscribers.
   *
   * @typeParam Schema The updated state schema.
   * @param registration State registration.
   * @param input State and version values to clone.
   * @returns Immutable update snapshot.
   */
  static #createUpdate<Schema extends MessageSchema>(
    registration: Registration<Schema>,
    input: {
      readonly id: unknown;
      readonly previousState: MessageShape<Schema> | undefined;
      readonly state: MessageShape<Schema>;
      readonly tenantId: TenantId | undefined;
      readonly version: Version | undefined;
    },
  ): StandUpdate<Schema> {
    const version = input.version === undefined ? undefined : clone(VersionSchema, input.version);
    return Object.freeze({
      typeUrl: registration.typeUrl,
      id: Stand.#cloneValue(input.id),
      ...(input.previousState === undefined
        ? {}
        : { previousState: clone(registration.schema, input.previousState) }),
      state: clone(registration.schema, input.state),
      ...(version === undefined ? {} : { version }),
      ...(input.tenantId === undefined ? {} : { tenantId: clone(TenantIdSchema, input.tenantId) }),
    });
  }

  static #readStateId(
    state: Message,
    registration: Pick<Registration, "schema" | "typeUrl" | "idField">,
  ): unknown {
    const id = (state as Record<string, unknown>)[registration.idField];
    if (id === undefined || id === null) {
      throw new Error(`Stand state "${registration.schema.typeName}" requires ID field.`);
    }
    return id;
  }

  static #cloneValue(value: unknown): unknown {
    return typeof value === "object" && value !== null ? globalThis.structuredClone(value) : value;
  }

  static #legacyPlan(query: RecordQuery<unknown>): NormalizedQueryPlan<unknown> {
    RecordQuery.validate(query);
    if (query.after !== undefined) {
      throw new Error("Stand query continuations require the normalized entity query API.");
    }
    const predicates = [
      ...(query.ids === undefined ? [] : [{ kind: "ids" as const, ids: query.ids }]),
      ...(query.filters ?? []).map((filter) => ({
        kind: "comparison" as const,
        column: filter.column,
        operator: "equal" as const,
        value: filter.value,
      })),
    ];
    return {
      ...(predicates.length === 0
        ? {}
        : {
            predicate:
              predicates.length === 1 ? predicates[0] : { kind: "all" as const, predicates },
          }),
      ...(query.sort === undefined
        ? {}
        : {
            order: query.sort
              .map((sort) => ({ field: sort.field, direction: sort.direction ?? "asc" }))
              .map(({ field, direction }) => ({ column: field, direction })),
          }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      candidateLimit: 10_000,
    };
  }

  /**
   * Opens the storage provider's Entity-record seam.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state message type.
   * @param factory Provider factory.
   * @param input Entity storage descriptor.
   * @returns Current-record storage and close handle.
   */
  static #openStorage<I, S extends Message>(
    factory: StorageFactory,
    input: EntityStorageInput<I, S>,
  ): { readonly current: EntityRecordStorage<I>; close(): void } {
    const candidate = factory as StorageFactory & Partial<EntityStorageFactory>;
    if (candidate.createEntityStorage === undefined) {
      throw new Error("StorageFactory does not provide the required entity-record storage seam.");
    }
    return candidate.createEntityStorage(input);
  }

  static #cloneContext(context: StorageMode): StorageMode {
    return Object.freeze({ name: context.name, multitenant: context.multitenant });
  }
}

/**
 * Provider seam for Entity record storage.
 */
interface EntityStorageFactory {
  /**
   * Opens current-record storage for one Entity state type.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state message type.
   * @param input Entity storage descriptor.
   * @returns Storage and a close handle.
   */
  createEntityStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): {
    readonly current: EntityRecordStorage<I>;

    /**
     * Closes the opened Entity storage handle.
     */
    close(): void;
  };
}

/**
 * Current-record storage with one idempotent release action.
 */
interface CurrentStorageLease {
  readonly current: EntityRecordStorage<unknown>;

  /**
   * Closes the storage handle after the operation.
   */
  release(): void;
}

/**
 * Deferred state update actions used by repository transactions.
 */
interface DeferredStandUpdate {
  /**
   * Delivers the persisted update to subscribers.
   */
  notify(): void;

  /**
   * Cancels the update without subscriber delivery.
   */
  cancel(): void;
}

/**
 * Deferred update that can first persist the current record.
 */
interface PreparedStandUpdate extends DeferredStandUpdate {
  /**
   * Persists the prepared state record.
   *
   * @returns Completion of persistence.
   */
  write(): Promise<void>;
}

/**
 * Repository-facing stored state and lifecycle.
 *
 * @typeParam Schema State schema.
 */
interface StandCurrentRecord<Schema extends MessageSchema> {
  readonly state: MessageShape<Schema>;

  /**
   * Complete persisted envelope used for storage compare-and-set.
   */
  readonly versionMessage: Version;
  readonly version: bigint;
  readonly archived: boolean;
  readonly deleted: boolean;
}

/**
 * Repository-only bridge to Stand operations.
 */
interface StandAccess {
  /**
   * Finds observer metadata for a registered type URL.
   *
   * @param stand Stand to inspect.
   * @param typeUrl State type URL, when present.
   * @returns Observer metadata, if registered.
   */
  observedState(stand: Stand, typeUrl: string | undefined): StandObservedState | undefined;

  /**
   * Registers an in-process state observer for a subscription.
   *
   * @param stand Stand supplying the state type.
   * @param subscription Subscription definition.
   * @param state Registered state metadata.
   * @param systemEventBus Bus receiving observer output.
   * @param onUpdate Callback for subscription updates.
   * @returns The subscription handle, if installed.
   */
  observeState(
    stand: Stand,
    subscription: Subscription,
    state: StandObservedState,
    systemEventBus: EventBus,
    onUpdate: (update: SubscriptionUpdate) => void,
  ): EventSubscription | undefined;

  /**
   * Reads a complete current state record for repository restoration.
   *
   * @typeParam Schema The registered state schema.
   * @param stand Stand to read.
   * @param schema Registered state schema.
   * @param id Entity ID to read.
   * @param options Tenant selection.
   * @returns Stored state and lifecycle, if present.
   */
  readCurrent<Schema extends MessageSchema>(
    stand: Stand,
    schema: Schema,
    id: unknown,
    options: StandReadOptions,
  ): Promise<StandCurrentRecord<Schema> | undefined>;

  /**
   * Prepares a repository update for deferred notification.
   *
   * @typeParam Schema The registered state schema.
   * @param stand Stand to update.
   * @param schema Registered state schema.
   * @param state New state value.
   * @param options Tenant and version metadata.
   * @returns Deferred update actions.
   */
  deferUpdate<Schema extends MessageSchema>(
    stand: Stand,
    schema: Schema,
    state: MessageShape<Schema>,
    options: StandUpdateOptions,
  ): Promise<DeferredStandUpdate>;
}

/**
 * Defines the repository-only persistence seam that defers subscriber delivery.
 *
 * @internal
 */
export const standAccess: StandAccess = Object.freeze({
  /**
   * Finds observer metadata on the supplied Stand.
   *
   * @param stand Stand to inspect.
   * @param typeUrl Candidate state type URL.
   * @returns Observer metadata, if registered.
   */
  observedState(stand: Stand, typeUrl: string | undefined): StandObservedState | undefined {
    if (!(stand instanceof Stand))
      throw new TypeError("State observation requires a Stand instance.");
    if (typeUrl === undefined) return undefined;
    return stand.observedState(typeUrl);
  },

  /**
   * Attaches a subscription observer to a registered state type.
   *
   * @param stand Stand supplying state metadata.
   * @param subscription Subscription definition.
   * @param state Registered state metadata.
   * @param systemEventBus Event bus for notifications.
   * @param onUpdate Callback for delivered updates.
   * @returns Subscription handle, if installed.
   */
  observeState(
    stand: Stand,
    subscription: Subscription,
    state: StandObservedState,
    systemEventBus: EventBus,
    onUpdate: (update: SubscriptionUpdate) => void,
  ): EventSubscription | undefined {
    if (!(stand instanceof Stand))
      throw new TypeError("State observation requires a Stand instance.");
    return SubscriptionObservers.observeState(subscription, state, systemEventBus, onUpdate);
  },

  /**
   * Reads complete current state for repository restoration.
   *
   * @typeParam Schema The registered state schema.
   * @param stand Stand to read.
   * @param schema Registered state schema.
   * @param id Entity ID to read.
   * @param options Tenant selection.
   * @returns Current state and lifecycle, if present.
   */
  readCurrent<Schema extends MessageSchema>(
    stand: Stand,
    schema: Schema,
    id: unknown,
    options: StandReadOptions,
  ): Promise<StandCurrentRecord<Schema> | undefined> {
    const read = currentReads.get(stand);
    if (read === undefined) throw new TypeError("Stand current read requires a Stand instance.");
    return read(schema, id, options);
  },

  /**
   * Prepares a state update that notifies subscribers after persistence.
   *
   * @typeParam Schema The registered state schema.
   * @param stand Stand to update.
   * @param schema Registered state schema.
   * @param state New state value.
   * @param options Tenant and version metadata.
   * @returns Deferred update actions.
   */
  deferUpdate<Schema extends MessageSchema>(
    stand: Stand,
    schema: Schema,
    state: MessageShape<Schema>,
    options: StandUpdateOptions,
  ): Promise<DeferredStandUpdate> {
    const deferred = deferredUpdates.get(stand);
    if (deferred === undefined)
      throw new TypeError("Stand deferred update requires a Stand instance.");
    return deferred(schema, state, options);
  },
});

/**
 * Defers a state update for repository persistence.
 *
 * @typeParam Schema The state schema.
 * @param schema Registered state schema.
 * @param state New state value.
 * @param options Tenant and version metadata.
 * @returns Prepared persistence actions.
 */
type DeferredUpdateCall = <Schema extends MessageSchema>(
  schema: Schema,
  state: MessageShape<Schema>,
  options: StandUpdateOptions,
) => Promise<DeferredStandUpdate>;

/**
 * Reads a current Entity record for repository restoration.
 *
 * @typeParam Schema The state schema.
 * @param schema Registered state schema.
 * @param id Entity ID to read.
 * @param options Tenant selection.
 * @returns Stored state and lifecycle, if present.
 */
type CurrentReadCall = <Schema extends MessageSchema>(
  schema: Schema,
  id: unknown,
  options: StandReadOptions,
) => Promise<StandCurrentRecord<Schema> | undefined>;

const deferredUpdates = new WeakMap<Stand, DeferredUpdateCall>();

const currentReads = new WeakMap<Stand, CurrentReadCall>();
