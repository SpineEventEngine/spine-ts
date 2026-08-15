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
import {
  cleanupOperationActive,
  type CleanupOperation,
  type DeliveryCleanupInput,
  type DeliveryCleanupStorage,
} from "../internal/delivery-cleanup.js";
import type { RecordSpec } from "../record/record-spec.js";
import type { StorageContext } from "../storage/storage.js";
import type { StorageGroup } from "../record/storage-group.js";
import { TenantRecords } from "./tenant-records.js";

/**
 * Provides an in-memory critical section for fenced delivery cleanup.
 */
export class MemoryDeliveryCleanupStorage implements DeliveryCleanupStorage {
  #open = true;

  /**
   * Creates an in-memory cleanup handle.
   *
   * @param records Resolves a tenant-scoped record family.
   */
  constructor(
    private readonly records: <I, R extends Message>(
      context: StorageContext,
      spec: RecordSpec<I, R>,
      group?: StorageGroup,
    ) => TenantRecords<I, R>,
  ) {}

  /**
   * Removes an exact Inbox record while its session record remains current.
   *
   * @param input Describes the records and ownership predicate for deletion.
   * @returns Whether the exact Inbox record was removed.
   */
  remove<InboxId, InboxRecord extends Message, SessionId, SessionRecord extends Message>(
    input: DeliveryCleanupInput<InboxId, InboxRecord, SessionId, SessionRecord>,
  ): Promise<boolean> {
    if (!this.#open) return Promise.reject(new Error("Delivery cleanup storage is closed."));
    if (!MemoryDeliveryCleanupStorage.active(input)) return Promise.resolve(false);
    const sessions = this.records(input.context, input.session.spec);
    const current = sessions.read(input.session.id);
    if (current === undefined || !input.session.isCurrent(current)) return Promise.resolve(false);
    const expectedSession = input.session.spec.materialize(input.session.expected);
    if (!sessions.compareAndSet(input.session.id, expectedSession, expectedSession))
      return Promise.resolve(false);
    const inbox = this.records(input.context, input.inbox.spec);
    return Promise.resolve(
      inbox.compareAndSet(
        input.inbox.id,
        input.inbox.spec.materialize(input.inbox.expected),
        undefined,
      ),
    );
  }

  /**
   * Closes this cleanup handle to further removal operations.
   */
  close(): void {
    this.#open = false;
  }
  private static active(input: { readonly operation?: CleanupOperation }): boolean {
    return cleanupOperationActive(input.operation);
  }
}
