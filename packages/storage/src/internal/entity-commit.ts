import type { Message } from "@bufbuild/protobuf";
import type { Event } from "@spine-event-engine/proto";

import type {
  EntityEventHistoryRecord,
  EntityStateHistoryRecord,
} from "../entity/entity-history-storage.js";
import type { EntityRecord } from "../entity/entity-record.js";
import type { StorageContext } from "../storage/storage.js";
import type { EntityStorageInput } from "./entity-history.js";
import type { StorageFactory } from "../storage/storage-factory.js";

/**
 * Describes one provider-owned atomic mutation for an Entity commit.
 *
 * This provider-only contract combines current state, retained histories, and
 * framework delivery events. It is intentionally not an application-level
 * transaction API.
 */
export interface EntityCommitInput<I, S extends Message> {
  // prettier-ignore

  /**
   * Identifies the storage scope that owns this commit.
   */
  readonly context: StorageContext;

  /**
   * Defines the Entity storage layout mutated by this commit.
   */
  readonly entity: EntityStorageInput<I, S>;

  /**
   * Identifies this source-signal commit within the Entity scope.
   */
  readonly id: string;

  /**
   * Identifies the Entity record being changed.
   */
  readonly entityId: I;

  /**
   * Requires this current record before applying the next record.
   */
  readonly expected?: EntityRecord;

  /**
   * Stores the next current record.
   */
  readonly next: EntityRecord;

  /**
   * Appends retained Entity state-history rows.
   */
  readonly states?: readonly EntityStateHistoryRecord<I, S>[];

  /**
   * Appends retained diagnostic Entity-event rows.
   */
  readonly diagnostics?: readonly EntityEventHistoryRecord<I>[];

  /**
   * Appends canonical framework delivery events.
   */
  readonly events?: readonly Event[];
}

/**
 * Reports the durable outcome of one Entity commit attempt.
 */
export type EntityCommitResult = "committed" | "replayed" | "conflict";

/**
 * A provider handle for atomic changes to one bounded Entity scope.
 */
export interface EntityCommitStorage {
  // prettier-ignore

  /**
   * Applies one complete Entity mutation or returns its durable prior outcome.
   *
   * @param input Defines the unit of Entity, history, and delivery-event work.
   * @returns Resolves to the committed, replayed, or conflict outcome.
   */
  commit<I, S extends Message>(input: EntityCommitInput<I, S>): Promise<EntityCommitResult>;

  /**
   * Closes this independently owned commit handle.
   */
  close(): void;
}

/**
 * Defines the provider-only storage-factory capability required by repositories.
 */
export interface EntityCommitStorageFactory {
  // prettier-ignore

  /**
   * Creates a handle that atomically mutates Entity persistence for one provider.
   *
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
   * Registers the atomic commit capability of one storage factory.
   *
   * @param factory Identifies the storage factory that provides the capability.
   * @param creator Creates atomic commit handles for that provider.
   */
  register(factory: StorageFactory, creator: EntityCommitStorageFactory): void;

  /**
   * Creates an atomic commit handle registered by a storage provider.
   *
   * @param factory Identifies the provider storage factory.
   * @param input Defines the Entity storage layout to commit.
   * @returns The provider-owned atomic commit handle.
   */
  create<I, S extends Message>(
    factory: StorageFactory,
    input: EntityStorageInput<I, S>,
  ): EntityCommitStorage;
}

/**
 * Provides the typed internal lookup for provider-owned atomic commit handles.
 *
 * Provider adapters register their creator while constructing their factory;
 * the end-user storage root deliberately exposes no commit-construction method.
 */
export const EntityCommitStorageFactories: EntityCommitFactoryAccess = Object.freeze({
  register(factory: StorageFactory, creator: EntityCommitStorageFactory): void {
    creators.set(factory, creator);
  },

  create<I, S extends Message>(
    factory: StorageFactory,
    input: EntityStorageInput<I, S>,
  ): EntityCommitStorage {
    const creator = creators.get(factory);
    if (creator === undefined)
      throw new Error("StorageFactory does not provide the required atomic Entity commit storage.");
    return creator.createEntityCommitStorage(input);
  },
});

const creators = new WeakMap<StorageFactory, EntityCommitStorageFactory>();
