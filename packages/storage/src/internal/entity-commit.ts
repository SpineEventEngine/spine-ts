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

import { clone, type Message } from "@bufbuild/protobuf";
import { EventSchema, type Event } from "@spine-event-engine/proto";
import type { AgentHistoryEntry, ModelPreference } from "@spine-event-engine/proto/agent";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";

import type { EntityRecord } from "../entity/entity-record.js";
import type { StorageContext } from "../storage/storage.js";
import type { EntityStorageInput } from "./entity-history.js";
import type { StorageFactory } from "../storage/storage-factory.js";
import { TenantBoundary } from "./tenancy.js";

/**
 * Describes one prepared provider mutation for an Entity commit.
 *
 * This provider-only ordinary `commit()` input combines current state, retained
 * histories, and framework delivery events. Providers write histories, diagnostic events,
 * delivery events, then current state independently. A failed commit can leave
 * a completed prefix on every provider. Single-record conditional operations
 * remain atomic per storage slot; this port does not coordinate multiple records.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 */
export interface EntityCommitInput<I, S extends Message> {
  // prettier-ignore

  /**
   * Identifies the storage scope for this commit.
   */
  readonly context: StorageContext;

  /**
   * Defines the Entity storage layout mutated by this commit.
   */
  readonly entity: EntityStorageInput<I, S>;

  /**
   * Identifies the Entity record being changed.
   */
  readonly entityId: I;

  /**
   * Stores the next current record.
   */
  readonly next: EntityRecord;

  /**
   * Adds retained Entity state-history rows.
   */
  readonly states?: readonly EntityRecord[];

  /**
   * Adds retained diagnostic Entity-event rows.
   */
  readonly diagnostics?: readonly Event[];

  /**
   * Adds canonical framework delivery events.
   */
  readonly events?: readonly Event[];
}

/**
 * One live Agent transition and its captured initial provider image.
 *
 * @typeParam I Typed Agent identifier.
 * @typeParam S Generated Agent state.
 */
export interface AgentCommitInput<I, S extends Message> {
  /**
   * Typed Agent identifier bound to this retained Entity commit handle.
   */
  readonly entityId: I;

  /**
   * Entity Version observed when the live turn began, including zero for absence.
   */
  readonly expectedVersion: number;

  /**
   * Absent record or complete preferences observed when the live turn began.
   */
  readonly expectedPreferences: readonly ModelPreference[] | undefined;

  /**
   * Complete preferences replacing the observed image.
   */
  readonly preferences: readonly ModelPreference[];

  /**
   * Optional changed current Entity and state-history mutation.
   */
  readonly entityCommit?: EntityCommitInput<I, S>;

  /**
   * Final Agent audit entries committed with state and preferences.
   */
  readonly historyEntries?: readonly AgentHistoryEntry[];
}

/**
 * Captures prepared Entity records before provider I/O or a bounded retry.
 *
 * Every retry reuses the same Entity ID, versions, and Event IDs; providers
 * never invoke the application handler to prepare a second mutation.
 */
export const EntityCommitSnapshots: Readonly<{
  /**
   * Captures one prepared mutation before provider I/O.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state message type.
   * @param input Supplies the prepared mutation.
   * @returns An independent mutation snapshot.
   */
  capture<I, S extends Message>(input: EntityCommitInput<I, S>): EntityCommitInput<I, S>;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Copies one mutation and its tenant boundary before the first await.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param input Supplies the prepared mutation.
   * @returns Independent records for every provider attempt.
   */
  capture<I, S extends Message>(input: EntityCommitInput<I, S>): EntityCommitInput<I, S> {
    const boundary = TenantBoundary.of(input.context);
    const context: StorageContext = boundary.tenantId === undefined
      ? { name: input.context.name, multitenant: false }
      : { name: input.context.name, multitenant: true, tenantId: boundary.tenantId };
    return {
      ...input,
      context,
      entity: { ...input.entity, context },
      entityId: input.entity.id.clone(input.entityId),
      next: clone(EntityRecordSchema, input.next),
      ...(input.states === undefined
        ? {}
        : { states: input.states.map((record) => clone(EntityRecordSchema, record)) }),
      ...(input.diagnostics === undefined
        ? {}
        : { diagnostics: input.diagnostics.map((event) => clone(EventSchema, event)) }),
      ...(input.events === undefined
        ? {}
        : { events: input.events.map((event) => clone(EventSchema, event)) }),
    };
  },
});

/**
 * A provider handle for one bounded Entity scope.
 *
 * An ordinary `commit()` may retain a completed prefix when a later record fails. Replaying
 * the same captured input reuses versions and Event IDs. An Event's presence
 * alone does not establish that current state was saved.
 * `commitAgent()` conditionally commits the complete live Agent transition atomically.
 */
export interface EntityCommitStorage {
  // prettier-ignore

  /**
   * Applies one Entity mutation across its current, history, and delivery records.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state message type.
   * @param input Defines the unit of Entity, history, and delivery-event work.
   * @returns Resolves when the Entity mutation completes.
   */
  commit<I, S extends Message>(input: EntityCommitInput<I, S>): Promise<void>;

  /**
   * Reads the current complete per-instance model selections.
   *
   * @param entityId Original typed Agent identifier.
   * @returns Defensive preferences, or absence of the preference record.
   */
  readAgentPreferences(entityId: unknown): Promise<readonly ModelPreference[] | undefined>;

  /**
   * Commits conditionally current state, final audit, and model selections together.
   *
   * @typeParam I Typed Agent identifier.
   * @typeParam S Generated Agent state.
   * @param input Captured initial images and prepared mutation.
   * @returns Completion after one provider-atomic conditional transition.
   */
  commitAgent<I, S extends Message>(input: AgentCommitInput<I, S>): Promise<void>;

  /**
   * Closes retained resources after admitted work settles.
   *
   * @returns The repeatable close outcome, including cleanup failures.
   */
  close(): Promise<void>;

  /**
   * Closes an idle commit handle during synchronous assembly rollback.
   */
  closeIdle(): void;
}

/**
 * Defines the provider-only storage-factory capability required by repositories.
 */
export interface EntityCommitStorageFactory {
  // prettier-ignore

  /**
   * Creates a handle that persists one Entity's prepared records.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state message type.
   * @param input Identifies the Entity storage layout the handle may commit.
   * @returns The independently closeable provider commit handle.
   */
  createEntityCommitStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): EntityCommitStorage;
}

/**
 * The framework-only access point for provider commit factories.
 */
interface EntityCommitFactoryAccess {
  // prettier-ignore

  /**
   * Registers the Entity commit capability of one storage factory.
   *
   * @param factory Identifies the storage factory that provides the capability.
   * @param creator Creates coordinated commit handles for that provider.
   */
  register(factory: StorageFactory, creator: EntityCommitStorageFactory): void;

  /**
   * Creates a commit handle registered by a storage provider.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state message type.
   * @param factory Identifies the provider storage factory.
   * @param input Defines the Entity storage layout to commit.
   * @returns The provider commit handle.
   */
  create<I, S extends Message>(
    factory: StorageFactory,
    input: EntityStorageInput<I, S>,
  ): EntityCommitStorage;
}

/**
 * Provides the typed internal lookup for provider-managed Entity commit handles.
 *
 * Provider adapters register their creator while constructing their factory;
 * the end-user storage root deliberately exposes no commit-construction method.
 */
export const EntityCommitStorageFactories: EntityCommitFactoryAccess = Object.freeze({
  register(factory: StorageFactory, creator: EntityCommitStorageFactory): void {
    creators.set(factory, creator);
  },

  /**
   * Creates the registered provider's Entity commit handle.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state message type.
   * @param factory Identifies the registered provider.
   * @param input Defines the Entity scope.
   * @returns The provider commit handle.
   */
  create<I, S extends Message>(
    factory: StorageFactory,
    input: EntityStorageInput<I, S>,
  ): EntityCommitStorage {
    const creator = creators.get(factory);
    if (creator === undefined)
      throw new Error("StorageFactory does not provide the required Entity commit storage.");
    return creator.createEntityCommitStorage(input);
  },
});

const creators = new WeakMap<StorageFactory, EntityCommitStorageFactory>();
