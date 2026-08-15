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

/** Framework-only provider input for one fenced exact delivered-row removal. */
export interface DeliveryCleanupInput<InboxId, InboxRecord extends Message, SessionId, SessionRecord extends Message> {
  readonly context: StorageContext;
  readonly inbox: { readonly spec: RecordSpec<InboxId, InboxRecord>; readonly id: InboxId; readonly expected: InboxRecord };
  readonly session: {
    readonly spec: RecordSpec<SessionId, SessionRecord>;
    readonly id: SessionId;
    readonly expected: SessionRecord;
    readonly isCurrent: (record: SessionRecord) => boolean;
  };
}

/** Provider-owned handle that validates a current session and deletes an exact Inbox record atomically. */
export interface DeliveryCleanupStorage {
  remove<InboxId, InboxRecord extends Message, SessionId, SessionRecord extends Message>(
    input: DeliveryCleanupInput<InboxId, InboxRecord, SessionId, SessionRecord>,
  ): Promise<boolean>;
  close(): void;
}

/** Provider factory capability deliberately narrower than a general transaction API. */
export interface DeliveryCleanupStorageFactory {
  createDeliveryCleanupStorage(): DeliveryCleanupStorage;
}

interface DeliveryCleanupFactoryAccess {
  register(factory: StorageFactory, creator: DeliveryCleanupStorageFactory): void;
  create(factory: StorageFactory): DeliveryCleanupStorage;
}

/** Internal provider registration for atomic direct-delivery cleanup. */
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
