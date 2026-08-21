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
} from "@spine-event-engine/storage/provider";
import type { RecordSpec, StorageContext } from "@spine-event-engine/storage";

import { DatastoreRecordStorage } from "./record-storage.js";

/**
 * Coordinates one fenced delivered Inbox deletion in Datastore.
 */
export class DatastoreDeliveryCleanupStorage implements DeliveryCleanupStorage {
  #open = true;

  /**
   * Creates a Datastore cleanup coordinator.
   *
   * @param openStorage Opens a record-storage handle for one record family.
   */
  constructor(
    private readonly openStorage: <I, R extends Message>(
      context: StorageContext,
      spec: RecordSpec<I, R>,
    ) => DatastoreRecordStorage<I, R>,
  ) {}

  /**
   * Removes an exact Inbox entity after validating its session entity in one transaction.
   *
   * @param input Describes the records and ownership predicate for deletion.
   * @returns Whether the transaction deleted the exact Inbox entity.
   */
  async remove<InboxId, InboxRecord extends Message, SessionId, SessionRecord extends Message>(
    input: DeliveryCleanupInput<InboxId, InboxRecord, SessionId, SessionRecord>,
  ): Promise<boolean> {
    if (!this.#open) throw new Error("Delivery cleanup storage is closed.");
    if (!DatastoreDeliveryCleanupStorage.active(input)) return false;
    const inbox = this.openStorage(input.context, input.inbox.spec);
    const sessions = this.openStorage(input.context, input.session.spec);
    const transaction = sessions.transaction();
    try {
      await transaction.run();
      const sessionEntity = DatastoreDeliveryCleanupStorage.first(
        await transaction.get(sessions.transactionEntity(input.session.expected).key),
      );
      if (!DatastoreDeliveryCleanupStorage.active(input)) {
        await transaction.rollback();
        return false;
      }
      if (
        sessionEntity === undefined ||
        !sessions.matchesTransactionEntity(sessionEntity, input.session.expected) ||
        !input.session.isCurrent(sessions.decodeTransactionEntity(sessionEntity))
      ) {
        await transaction.rollback();
        return false;
      }
      const expectedInbox = inbox.transactionEntity(input.inbox.expected);
      const inboxEntity = DatastoreDeliveryCleanupStorage.first(
        await transaction.get(expectedInbox.key),
      );
      if (
        inboxEntity === undefined ||
        !inbox.matchesTransactionEntity(inboxEntity, input.inbox.expected)
      ) {
        await transaction.rollback();
        return false;
      }
      if (!input.session.isCurrent(sessions.decodeTransactionEntity(sessionEntity))) {
        await transaction.rollback();
        return false;
      }
      if (!DatastoreDeliveryCleanupStorage.active(input)) {
        await transaction.rollback();
        return false;
      }
      transaction.delete(expectedInbox.key);
      if (!input.session.isCurrent(sessions.decodeTransactionEntity(sessionEntity))) {
        await transaction.rollback();
        return false;
      }
      if (!DatastoreDeliveryCleanupStorage.active(input)) {
        await transaction.rollback();
        return false;
      }
      await transaction.commit();
      return true;
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      throw error;
    } finally {
      inbox.close();
      sessions.close();
    }
  }

  /**
   * Closes this cleanup coordinator to further removal operations.
   */
  close(): void {
    this.#open = false;
  }
  private static first(value: unknown): Record<string | symbol, unknown> | undefined {
    return Array.isArray(value) &&
      value.length > 0 &&
      typeof value[0] === "object" &&
      value[0] !== null
      ? (value[0] as Record<string | symbol, unknown>)
      : undefined;
  }
  private static active(input: { readonly operation?: CleanupOperation }): boolean {
    return cleanupOperationActive(input.operation);
  }
}
