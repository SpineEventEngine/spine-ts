/*
 * Copyright 2026, CodeMatters. All rights reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import { toBinary, type Message } from "@bufbuild/protobuf";
import type { PoolConnection } from "mysql2/promise";
import type {
  DeliveryCleanupInput,
  DeliveryCleanupStorage,
} from "@spine-event-engine/storage/internal/delivery-cleanup";
import type { RecordSpec, StorageContext } from "@spine-event-engine/storage";

import { MysqlRecordStorage } from "./record-storage.js";

/** Provider-owned MySQL coordinator for one fenced delivered Inbox deletion. */
export class MysqlDeliveryCleanupStorage implements DeliveryCleanupStorage {
  #open = true;

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

  async remove<InboxId, InboxRecord extends Message, SessionId, SessionRecord extends Message>(
    input: DeliveryCleanupInput<InboxId, InboxRecord, SessionId, SessionRecord>,
  ): Promise<boolean> {
    if (!this.#open) throw new Error("Delivery cleanup storage is closed.");
    const inbox = this.openStorage(input.context, input.inbox.spec);
    const sessions = this.openStorage(input.context, input.session.spec);
    try {
      await Promise.all([inbox.prepare(), sessions.prepare()]);
      return await this.coordinate(
        input.context,
        [inbox.tableName, sessions.tableName],
        this.lockKey(input as unknown as DeliveryCleanupInput<unknown, Message, unknown, Message>),
        async (connection) => this.removeOn(connection, inbox, sessions, input),
      );
    } finally {
      inbox.close();
      sessions.close();
    }
  }

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
    return sessions.withConnection(connection, () =>
      inbox.withConnection(connection, async () => {
        const currentSession = await sessions.readLocked(input.session.id);
        if (
          currentSession === undefined ||
          !same(input.session.spec, currentSession, input.session.expected) ||
          !input.session.isCurrent(currentSession)
        )
          return false;
        const currentInbox = await inbox.readLocked(input.inbox.id);
        if (
          currentInbox === undefined ||
          !same(input.inbox.spec, currentInbox, input.inbox.expected)
        )
          return false;
        return inbox.compareAndSet(input.inbox.id, input.inbox.expected, undefined);
      }),
    );
  }
}

function same<I, R extends Message>(spec: RecordSpec<I, R>, left: R, right: R): boolean {
  return Buffer.from(toBinary(spec.recordType, left)).equals(
    Buffer.from(toBinary(spec.recordType, right)),
  );
}
