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

import type { Message } from "@bufbuild/protobuf";

import type { RecordSpec } from "../record/record-spec.js";
import type { StorageContext } from "../storage/storage.js";
import type { StorageFactory } from "../storage/storage-factory.js";

/**
 * Describes cooperative operation state at a provider safe boundary.
 */
export interface CleanupOperation {
  // prettier-ignore

  /**
   * Indicates whether cancellation has been requested.
   */
  readonly signal?: { readonly aborted: boolean };

  /**
   * Carries the admitted non-negative timeout budget.
   */
  readonly timeoutMs?: number;

  /**
   * Determines whether the admission-relative deadline remains active.
   *
   * @returns Whether provider work remains within its admitted deadline.
   */
  readonly isActive?: () => boolean;
}

/**
 * Determines whether a cleanup operation may proceed at a provider safe boundary.
 *
 * @param operation Supplies cooperative cancellation and deadline state.
 * @returns Whether provider work may continue.
 */
export function cleanupOperationActive(operation: CleanupOperation | undefined): boolean {
  return (
    !operation?.signal?.aborted && operation?.timeoutMs !== 0 && operation?.isActive?.() !== false
  );
}

/**
 * Describes provider input for one fenced exact delivered-row removal.
 */
export interface DeliveryCleanupInput<
  InboxId,
  InboxRecord extends Message,
  SessionId,
  SessionRecord extends Message,
> {
  // prettier-ignore

  /**
   * Selects the tenant and storage group containing both records.
   */
  readonly context: StorageContext;

  /**
   * Carries cooperative cancellation and an internal admission-relative activity predicate.
   */
  readonly operation?: CleanupOperation;

  /**
   * Describes the exact delivered Inbox record expected for deletion.
   */
  readonly inbox: {
    readonly spec: RecordSpec<InboxId, InboxRecord>;
    readonly id: InboxId;
    readonly expected: InboxRecord;
  };

  /**
   * Describes the current shard-session record that fences deletion.
   */
  readonly session: {
    readonly spec: RecordSpec<SessionId, SessionRecord>;
    readonly id: SessionId;
    readonly expected: SessionRecord;
    readonly isCurrent: (record: SessionRecord) => boolean;
  };
}

/**
 * Defines a provider-owned handle for atomically deleting a fenced Inbox record.
 */
export interface DeliveryCleanupStorage {
  // prettier-ignore

  /**
   * Removes an exact Inbox record after validating the current session.
   *
   * @param input Describes the records and ownership predicate for deletion.
   * @returns Whether the provider deleted the exact Inbox record.
   */
  remove<InboxId, InboxRecord extends Message, SessionId, SessionRecord extends Message>(
    input: DeliveryCleanupInput<InboxId, InboxRecord, SessionId, SessionRecord>,
  ): Promise<boolean>;
  // prettier-ignore

  /**
   * Closes this cleanup handle to further removal operations.
   */
  close(): void;
}

/**
 * Defines a provider factory capability narrower than a general transaction API.
 */
export interface DeliveryCleanupStorageFactory {
  // prettier-ignore

  /**
   * Creates a provider-owned cleanup handle.
   *
   * @returns The cleanup handle bound to this provider.
   */
  createDeliveryCleanupStorage(): DeliveryCleanupStorage;
}

interface DeliveryCleanupFactoryAccess {
  register(factory: StorageFactory, creator: DeliveryCleanupStorageFactory): void;
  create(factory: StorageFactory): DeliveryCleanupStorage;
}

/**
 * Registers and resolves provider cleanup handles for direct delivery.
 */
export const DeliveryCleanupStorageFactories: DeliveryCleanupFactoryAccess = Object.freeze({
  register(factory: StorageFactory, creator: DeliveryCleanupStorageFactory): void {
    creators.set(factory, creator);
  },
  create(factory: StorageFactory): DeliveryCleanupStorage {
    const creator = creators.get(factory);
    if (creator === undefined)
      throw new Error("StorageFactory does not provide atomic delivery cleanup storage.");
    return creator.createDeliveryCleanupStorage();
  },
});

const creators = new WeakMap<StorageFactory, DeliveryCleanupStorageFactory>();
