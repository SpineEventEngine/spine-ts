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

import { toBinary, type Message } from "@bufbuild/protobuf";
import {
  cleanupOperationActive,
  type DeliveryCleanupInput,
  type DeliveryCleanupStorage,
} from "@spine-event-engine/storage/provider";
import type { RecordSpec, StorageContext } from "@spine-event-engine/storage";
import type { PoolClient } from "pg";

import {
  PostgresRollbackErrors,
  PostgresStorageOperationError,
  PostgresTransactionErrors,
} from "./errors.js";
import { PostgresRecordStorage, type PostgresRecordLifecycle } from "./record-storage.js";

/**
 * Opens one tenant-bound PostgreSQL record family.
 *
 * @typeParam I Record identifier type.
 * @typeParam R Stored Protobuf record type.
 */
type OpenRecords = <I, R extends Message>(
  context: StorageContext,
  spec: RecordSpec<I, R>,
) => PostgresRecordStorage<I, R>;

/**
 * Deletes one delivered Inbox row only while its expected session record remains current.
 */
export class PostgresDeliveryCleanupStorage implements DeliveryCleanupStorage {
  #open = true;

  /**
   * Creates a PostgreSQL cleanup handle.
   *
   * @param open Opens tenant-bound Inbox and session record families.
   * @param lifecycle Resolves the exact tenant-bound transaction lifecycle.
   * @param onClose Removes this handle from the factory's live-handle set.
   */
  constructor(
    private readonly open: OpenRecords,
    private readonly lifecycle: (context: StorageContext) => PostgresRecordLifecycle,
    private readonly onClose: () => void,
  ) {}

  /**
   * Removes an exact Inbox row while its session snapshot remains current.
   *
   * @typeParam InboxId Inbox record identifier type.
   * @typeParam InboxRecord Inbox record message type.
   * @typeParam SessionId Session record identifier type.
   * @typeParam SessionRecord Session record message type.
   * @param input Describes the expected Inbox and session records.
   * @returns Whether the exact Inbox row was deleted.
   */
  async remove<InboxId, InboxRecord extends Message, SessionId, SessionRecord extends Message>(
    input: DeliveryCleanupInput<InboxId, InboxRecord, SessionId, SessionRecord>,
  ): Promise<boolean> {
    this.requireOpen();
    if (!PostgresCleanupValues.active(input)) return false;
    const inbox = this.open(input.context, input.inbox.spec);
    const sessions = this.open(input.context, input.session.spec);
    try {
      await inbox.prepare();
      await sessions.prepare();
      if (!PostgresCleanupValues.active(input)) return false;
      return await this.coordinate(input, inbox, sessions);
    } catch (error) {
      if (error instanceof CleanupExpired) return false;
      throw error;
    } finally {
      inbox.close();
      sessions.close();
    }
  }

  /**
   * Closes this handle to new cleanup operations.
   */
  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.onClose();
  }

  /**
   * Executes one cleanup transaction with one retry for a serialization conflict.
   *
   * @typeParam InboxId Inbox record identifier type.
   * @typeParam InboxRecord Inbox record message type.
   * @typeParam SessionId Session record identifier type.
   * @typeParam SessionRecord Session record message type.
   * @param input Describes the expected Inbox and session records.
   * @param inbox Provides the delivered Inbox record family.
   * @param sessions Provides the session record family.
   * @returns Whether the transaction deleted the Inbox row.
   */
  private async coordinate<
    InboxId,
    InboxRecord extends Message,
    SessionId,
    SessionRecord extends Message,
  >(
    input: DeliveryCleanupInput<InboxId, InboxRecord, SessionId, SessionRecord>,
    inbox: PostgresRecordStorage<InboxId, InboxRecord>,
    sessions: PostgresRecordStorage<SessionId, SessionRecord>,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const client = await this.lifecycle(input.context).acquire();
      let discard: Error | undefined;
      try {
        await client.query("BEGIN");
        const result = await this.removeOn(client, input, inbox, sessions);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          discard = PostgresRollbackErrors.discard(error);
        }
        if (error instanceof CleanupExpired) throw error;
        if (attempt === 0 && PostgresTransactionErrors.retryable(error)) continue;
        throw PostgresCleanupErrors.operation(error);
      } finally {
        client.release(discard);
      }
    }
    throw new Error("Unreachable PostgreSQL cleanup retry.");
  }

  /**
   * Checks the expected records and deletes the Inbox row on one transaction client.
   *
   * @typeParam InboxId Inbox record identifier type.
   * @typeParam InboxRecord Inbox record message type.
   * @typeParam SessionId Session record identifier type.
   * @typeParam SessionRecord Session record message type.
   * @param client PostgreSQL transaction client.
   * @param input Describes the expected Inbox and session records.
   * @param inbox Provides the delivered Inbox record family.
   * @param sessions Provides the session record family.
   * @returns Whether the exact Inbox row was deleted.
   */
  private async removeOn<
    InboxId,
    InboxRecord extends Message,
    SessionId,
    SessionRecord extends Message,
  >(
    client: PoolClient,
    input: DeliveryCleanupInput<InboxId, InboxRecord, SessionId, SessionRecord>,
    inbox: PostgresRecordStorage<InboxId, InboxRecord>,
    sessions: PostgresRecordStorage<SessionId, SessionRecord>,
  ): Promise<boolean> {
    if (!PostgresCleanupValues.active(input)) return false;
    const session = sessions.historyExecutor();
    const delivered = inbox.historyExecutor();
    await client.query("SELECT pg_advisory_xact_lock($1)", [session.lockRecord(input.session.id)]);
    if (!PostgresCleanupValues.active(input)) return false;
    const currentSession = await session.read(client, input.session.id, "for-update");
    if (!PostgresCleanupValues.active(input)) return false;
    if (!PostgresCleanupValues.current(input, currentSession)) return false;
    const currentInbox = await delivered.read(client, input.inbox.id, "for-update");
    if (!PostgresCleanupValues.same(input.inbox.spec, currentInbox, input.inbox.expected))
      return false;
    if (!PostgresCleanupValues.active(input)) return false;
    const removed = await delivered.delete(client, input.inbox.id);
    if (!PostgresCleanupValues.active(input)) throw new CleanupExpired();
    return removed;
  }

  /**
   * Rejects cleanup after this handle has closed.
   */
  private requireOpen(): void {
    if (!this.#open) throw new PostgresStorageOperationError("Delivery cleanup storage is closed.");
  }
}

const PostgresCleanupValues = Object.freeze({
  /**
   * Checks whether the caller still permits the cleanup operation.
   *
   * @param input Carries the optional operation lifetime.
   * @returns Whether cleanup may continue.
   */
  active(input: {
    readonly operation?: DeliveryCleanupInput<never, never, never, never>["operation"];
  }): boolean {
    return cleanupOperationActive(input.operation);
  },

  /**
   * Compares the current session with the expected cleanup session.
   *
   * @typeParam InboxId Inbox record identifier type.
   * @typeParam InboxRecord Inbox record message type.
   * @typeParam SessionId Session record identifier type.
   * @typeParam SessionRecord Session record message type.
   * @param input Describes the expected cleanup records.
   * @param actual Session record read inside the transaction.
   * @returns Whether the session is still current and unchanged.
   */
  current<InboxId, InboxRecord extends Message, SessionId, SessionRecord extends Message>(
    input: DeliveryCleanupInput<InboxId, InboxRecord, SessionId, SessionRecord>,
    actual: SessionRecord | undefined,
  ): boolean {
    return (
      actual !== undefined &&
      input.session.isCurrent(actual) &&
      this.same(input.session.spec, actual, input.session.expected)
    );
  },

  /**
   * Compares two records through their Protobuf wire representation.
   *
   * @typeParam I Record identifier type.
   * @typeParam R Stored Protobuf record type.
   * @param spec Describes the stored record schema.
   * @param left Record read from PostgreSQL.
   * @param right Expected record value.
   * @returns Whether both records have identical wire bytes.
   */
  same<I, R extends Message>(spec: RecordSpec<I, R>, left: R | undefined, right: R): boolean {
    return (
      left !== undefined &&
      Buffer.compare(toBinary(spec.recordType, left), toBinary(spec.recordType, right)) === 0
    );
  },
});

const PostgresCleanupErrors = Object.freeze({
  /**
   * Converts an internal cleanup failure to the stable provider error.
   *
   * @param error Failure raised inside the cleanup transaction.
   * @returns Stable public cleanup error.
   */
  operation(error: unknown): PostgresStorageOperationError {
    return error instanceof PostgresStorageOperationError
      ? error
      : new PostgresStorageOperationError("PostgreSQL delivery cleanup failed.");
  },
});

/**
 * Signals that the cleanup lifetime ended after deletion but before commit.
 */
class CleanupExpired extends Error {}
