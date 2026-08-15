/*
 * Copyright 2026, CodeMatters. All rights reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import type { Message } from "@bufbuild/protobuf";
import type {
  DeliveryCleanupInput,
  DeliveryCleanupStorage,
} from "@spine-event-engine/storage/internal/delivery-cleanup";
import type { RecordSpec, StorageContext } from "@spine-event-engine/storage";

import { DatastoreRecordStorage } from "./record-storage.js";

/** Provider-owned Datastore transaction for one fenced delivered Inbox deletion. */
export class DatastoreDeliveryCleanupStorage implements DeliveryCleanupStorage {
  #open = true;

  constructor(
    private readonly openStorage: <I, R extends Message>(
      context: StorageContext,
      spec: RecordSpec<I, R>,
    ) => DatastoreRecordStorage<I, R>,
  ) {}

  async remove<InboxId, InboxRecord extends Message, SessionId, SessionRecord extends Message>(
    input: DeliveryCleanupInput<InboxId, InboxRecord, SessionId, SessionRecord>,
  ): Promise<boolean> {
    if (!this.#open) throw new Error("Delivery cleanup storage is closed.");
    const inbox = this.openStorage(input.context, input.inbox.spec);
    const sessions = this.openStorage(input.context, input.session.spec);
    const transaction = sessions.transaction();
    try {
      await transaction.run();
      const sessionEntity = first(
        await transaction.get(sessions.transactionEntity(input.session.expected).key),
      );
      if (
        sessionEntity === undefined ||
        !sessions.matchesTransactionEntity(sessionEntity, input.session.expected) ||
        !input.session.isCurrent(sessions.decodeTransactionEntity(sessionEntity))
      ) {
        await transaction.rollback();
        return false;
      }
      const expectedInbox = inbox.transactionEntity(input.inbox.expected);
      const inboxEntity = first(await transaction.get(expectedInbox.key));
      if (
        inboxEntity === undefined ||
        !inbox.matchesTransactionEntity(inboxEntity, input.inbox.expected)
      ) {
        await transaction.rollback();
        return false;
      }
      transaction.delete(expectedInbox.key);
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

  close(): void {
    this.#open = false;
  }
}

function first(value: unknown): Record<string | symbol, unknown> | undefined {
  return Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === "object" &&
    value[0] !== null
    ? (value[0] as Record<string | symbol, unknown>)
    : undefined;
}
