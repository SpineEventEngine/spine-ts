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
import type { PoolConnection } from "mysql2/promise";
import {
  cleanupOperationActive,
  type CleanupOperation,
  type DeliveryCleanupInput,
  type DeliveryCleanupStorage,
} from "@spine-event-engine/storage/provider";
import type { RecordSpec, StorageContext } from "@spine-event-engine/storage";

import { MysqlRecordStorage } from "./record-storage.js";

/**
 * Coordinates one fenced delivered Inbox deletion in MySQL.
 */
export class MysqlDeliveryCleanupStorage implements DeliveryCleanupStorage {
  #open = true;

  /**
   * Creates a MySQL cleanup coordinator.
   *
   * @param openStorage Opens a record-storage handle for one record family.
   * @param coordinate Runs work under the provider's two-family coordinator.
   * @param lockKey Derives the provider coordination key from cleanup input.
   */
  constructor(
    private readonly openStorage: <I, R extends Message>(
      context: StorageContext,
      spec: RecordSpec<I, R>,
    ) => MysqlRecordStorage<I, R>,
    private readonly coordinate: <T>(
      context: StorageContext,
      tables: readonly string[],
      key: string,
      work: (connection: PoolConnection) => Promise<T>,
    ) => Promise<T>,
    private readonly lockKey: (
      input: DeliveryCleanupInput<unknown, Message, unknown, Message>,
    ) => string,
  ) {}

  /**
   * Removes an exact Inbox row after locking and validating its session row.
   *
   * @param input Describes the records and ownership predicate for deletion.
   * @returns Whether the coordinator deleted the exact Inbox row.
   */
  async remove<InboxId, InboxRecord extends Message, SessionId, SessionRecord extends Message>(
    input: DeliveryCleanupInput<InboxId, InboxRecord, SessionId, SessionRecord>,
  ): Promise<boolean> {
    if (!this.#open) throw new Error("Delivery cleanup storage is closed.");
    if (!MysqlDeliveryCleanupStorage.active(input)) return false;
    const inbox = this.openStorage(input.context, input.inbox.spec);
    const sessions = this.openStorage(input.context, input.session.spec);
    try {
      await Promise.all([inbox.prepare(), sessions.prepare()]);
      if (!MysqlDeliveryCleanupStorage.active(input)) return false;
      return await this.coordinate(
        input.context,
        [inbox.tableName, sessions.tableName],
        this.lockKey(input as unknown as DeliveryCleanupInput<unknown, Message, unknown, Message>),
        async (connection) => this.removeOn(connection, inbox, sessions, input),
      );
    } catch (error) {
      if (error instanceof CleanupExpired) return false;
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

  private async removeOn<
    InboxId,
    InboxRecord extends Message,
    SessionId,
    SessionRecord extends Message,
  >(
    connection: PoolConnection,
    inbox: MysqlRecordStorage<InboxId, InboxRecord>,
    sessions: MysqlRecordStorage<SessionId, SessionRecord>,
    input: DeliveryCleanupInput<InboxId, InboxRecord, SessionId, SessionRecord>,
  ): Promise<boolean> {
    if (!MysqlDeliveryCleanupStorage.active(input)) return false;
    return sessions.withConnection(connection, () =>
      inbox.withConnection(connection, async () => {
        const currentSession = await sessions.readLocked(input.session.id);
        if (
          currentSession === undefined ||
          !MysqlDeliveryCleanupStorage.same(
            input.session.spec,
            currentSession,
            input.session.expected,
          ) ||
          !input.session.isCurrent(currentSession)
        ) {
          return false;
        }
        const currentInbox = await inbox.readLocked(input.inbox.id);
        if (
          currentInbox === undefined ||
          !MysqlDeliveryCleanupStorage.same(input.inbox.spec, currentInbox, input.inbox.expected)
        ) {
          return false;
        }
        if (!input.session.isCurrent(currentSession)) return false;
        if (!MysqlDeliveryCleanupStorage.active(input)) return false;
        const removed = await inbox.delete(input.inbox.id);
        if (!input.session.isCurrent(currentSession)) throw new CleanupExpired();
        if (!MysqlDeliveryCleanupStorage.active(input)) throw new CleanupExpired();
        return removed;
      }),
    );
  }
  private static same<I, R extends Message>(spec: RecordSpec<I, R>, left: R, right: R): boolean {
    return Buffer.from(toBinary(spec.recordType, left)).equals(
      Buffer.from(toBinary(spec.recordType, right)),
    );
  }
  private static active(input: { readonly operation?: CleanupOperation }): boolean {
    return cleanupOperationActive(input.operation);
  }
}

class CleanupExpired extends Error {}
