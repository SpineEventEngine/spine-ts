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

import { randomUUID } from "node:crypto";
import { create, toBinary } from "@bufbuild/protobuf";
import { Datastore } from "@google-cloud/datastore";
import { AgentHistoryEntrySchema, ConversationIdSchema } from "@spine-event-engine/proto/agent";
import {
  AgentHistoryConformance,
  AgentHistoryKeys,
  AgentHistoryStorageFactories,
  AgentHistoryRecords,
} from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";

import {
  conversation,
  response,
  event,
  occurredAt,
  scope,
} from "../../storage/test/entity/agent-history-fixtures.js";
import { DatastoreStorageFactory } from "../src/index.js";
import { AgentHistoryHash } from "../src/datastore/agent-history.js";
import { AgentHistoryRecordSchema } from "@spine-event-engine/proto/generated/spine/server/agent/history_record_pb.js";

const emulatorHost = process.env.DATASTORE_EMULATOR_HOST;

describe.runIf(emulatorHost !== undefined)("Datastore Agent history", () => {
  it("rejects creation of an Agent history handle after factory closure", async () => {
    const client = new Datastore({ projectId: `spine-agent-closed-${randomUUID()}` });
    const factory = DatastoreStorageFactory.newBuilder().setClient(client).build();
    await factory.close();
    expect(() => AgentHistoryStorageFactories.create(factory, scope)).toThrow(
      "StorageFactory is closed.",
    );
  });

  it("passes provider conformance in the emulator", async () => {
    const client = new Datastore({ projectId: `spine-agent-history-${randomUUID()}` });
    const factory = DatastoreStorageFactory.newBuilder().setClient(client).build();
    try {
      await AgentHistoryConformance.check({
        scope,
        open: (input) => AgentHistoryStorageFactories.create(factory, input),
        conversation,
        response,
        system: (id, time) => event(id, time, true),
        domain: (id, time) => event(id, time, false),
        occurredAt,
      });
    } finally {
      await factory.close();
    }
  }, 120_000);

  it("reopens persisted entries in the fixed indexed kind", async () => {
    const client = new Datastore({ projectId: `spine-agent-reopen-${randomUUID()}` });
    const input = { ...scope, stateType: `${scope.stateType}.datastore.reopen` };
    const entry = event("reopen-datastore", occurredAt(1_789_000_001n, 123_456_789), false);
    const firstFactory = DatastoreStorageFactory.newBuilder().setClient(client).build();
    const first = AgentHistoryStorageFactories.create(firstFactory, input);
    await first.append("ticket-datastore", entry);
    first.close();
    await firstFactory.close();
    const reopened = DatastoreStorageFactory.newBuilder().setClient(client).build();
    try {
      const history = AgentHistoryStorageFactories.create(reopened, input);
      const page = await history.read({
        entityId: "ticket-datastore",
        view: { kind: "full" },
        count: 1,
        maxBytes: 10000,
      });
      expect(page.entries.map((value) => toBinary(AgentHistoryEntrySchema, value))).toEqual([
        toBinary(AgentHistoryEntrySchema, entry),
      ]);
      const digest = AgentHistoryHash.value(
        AgentHistoryRecords.scope(input.stateType, input.id.key("ticket-datastore")),
      );
      const [stored] = await client.runQuery(
        client.createQuery("spine_agent_history").filter("scope_digest", "=", digest),
      );
      expect(stored).toHaveLength(1);
      history.close();
    } finally {
      await reopened.close();
    }
  }, 120_000);

  it("rolls back a captured audit group when its later row conflicts", async () => {
    const client = new Datastore({ projectId: `spine-agent-batch-${randomUUID()}` });
    const factory = DatastoreStorageFactory.newBuilder().setClient(client).build();
    const input = { ...scope, stateType: `${scope.stateType}.batch.${randomUUID()}` };
    const history = AgentHistoryStorageFactories.create(factory, input);
    const first = event("batch-first", occurredAt(1_789_200_001n), false);
    const original = conversation("batch-conflict", "dialog", occurredAt(1_789_200_002n));
    const conflicting = response("batch-conflict", "dialog", occurredAt(1_789_200_002n));
    try {
      await history.append("ticket", original);
      await expect(history.appendAll("ticket", [first, conflicting])).rejects.toThrow();
      const page = await history.read({
        entityId: "ticket",
        view: { kind: "full" },
        count: 4,
        maxBytes: 10000,
      });
      expect(page.entries.map((entry) => AgentHistoryKeys.fromEntry(entry).recordId)).toEqual([
        "batch-conflict",
      ]);
      await history.appendAll("ticket", [original]);
    } finally {
      history.close();
      await factory.close();
    }
  }, 120_000);

  it("drains an admitted audit group before factory close releases its handle", async () => {
    const client = new Datastore({ projectId: `spine-agent-drain-${randomUUID()}` });
    const factory = DatastoreStorageFactory.newBuilder().setClient(client).build();
    const history = AgentHistoryStorageFactories.create(factory, scope);
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const transaction = client.transaction();
    const run = transaction.run.bind(transaction);
    vi.spyOn(client, "transaction").mockReturnValueOnce(transaction);
    // Native Transaction.run is typed void even though the SDK returns a promise.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    vi.spyOn(transaction, "run").mockImplementation(async () => {
      entered.resolve(undefined);
      await release.promise;
      return run();
    });
    const entry = event(`drain-${randomUUID()}`, occurredAt(1_789_200_003n), false);
    try {
      const batch = history.appendAll("ticket", [entry]);
      await entered.promise;
      let closed = false;
      const closing = factory.close().then(() => {
        closed = true;
      });
      await Promise.resolve();
      expect(closed).toBe(false);
      await expect(history.appendAll("ticket", [entry])).rejects.toThrow(
        "StorageFactory is closed.",
      );
      release.resolve(undefined);
      await batch;
      await closing;
      expect(closed).toBe(true);
    } finally {
      release.resolve(undefined);
      history.close();
      await factory.close();
    }
  }, 120_000);

  it("captures audit identity before the caller can mutate an admitted entry", async () => {
    const client = new Datastore({ projectId: `spine-agent-snapshot-${randomUUID()}` });
    const factory = DatastoreStorageFactory.newBuilder().setClient(client).build();
    const history = AgentHistoryStorageFactories.create(factory, scope);
    const originalId = `captured-${randomUUID()}`;
    const entry = event(originalId, occurredAt(1_789_200_004n), false);
    try {
      const pending = history.appendAll("ticket", [entry]);
      if (entry.item.case !== "domainEvent" || entry.item.value.id === undefined)
        throw new Error("Expected domain Event fixture.");
      entry.item.value.id.value = `mutated-${randomUUID()}`;
      await pending;
      const page = await history.read({
        entityId: "ticket",
        view: { kind: "full" },
        count: 1,
        maxBytes: 10000,
      });
      expect(page.entries.map((value) => AgentHistoryKeys.fromEntry(value).recordId)).toEqual([
        originalId,
      ]);
    } finally {
      history.close();
      await factory.close();
    }
  }, 120_000);

  it("rejects a native row whose indexed digest conceals a different original scope", async () => {
    const client = new Datastore({ projectId: `spine-agent-collision-${randomUUID()}` });
    const factory = DatastoreStorageFactory.newBuilder().setClient(client).build();
    const history = AgentHistoryStorageFactories.create(factory, scope);
    const entry = event("collision", occurredAt(8n), false);
    const wrong = AgentHistoryRecords.record(scope.stateType, "different-ticket", entry);
    const requested = AgentHistoryHash.value(AgentHistoryRecords.scope(scope.stateType, "ticket"));
    const order = AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(entry));
    try {
      await client.save({
        key: client.key(["spine_agent_history", randomUUID()]),
        data: {
          bytes: Buffer.from(toBinary(AgentHistoryRecordSchema, wrong)),
          scope_digest: requested,
          order_key: order,
          category: "domain",
        },
        excludeFromIndexes: ["bytes"],
      });
      await expect(
        history.read({ entityId: "ticket", view: { kind: "full" }, count: 1, maxBytes: 10000 }),
      ).rejects.toThrow("scope digest collides");
    } finally {
      history.close();
      await factory.close();
    }
  });

  it("rejects a native conversation digest that conceals another conversation", async () => {
    const client = new Datastore({ projectId: `spine-agent-conversation-${randomUUID()}` });
    const factory = DatastoreStorageFactory.newBuilder().setClient(client).build();
    const history = AgentHistoryStorageFactories.create(factory, scope);
    const entry = conversation("collision", "other-conversation", occurredAt(8n));
    const record = AgentHistoryRecords.record(scope.stateType, "ticket", entry);
    const requested = AgentHistoryHash.value(AgentHistoryRecords.scope(scope.stateType, "ticket"));
    const order = AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(entry));
    try {
      await client.save({
        key: client.key(["spine_agent_history", randomUUID()]),
        data: {
          bytes: Buffer.from(toBinary(AgentHistoryRecordSchema, record)),
          scope_digest: requested,
          conversation_digest: AgentHistoryHash.value("requested-conversation"),
          order_key: order,
          category: "conversation",
        },
        excludeFromIndexes: ["bytes"],
      });
      await expect(
        history.read({
          entityId: "ticket",
          view: {
            kind: "conversation",
            conversation: create(ConversationIdSchema, { value: "requested-conversation" }),
          },
          count: 1,
          maxBytes: 10000,
        }),
      ).rejects.toThrow("conversation digest collides");
    } finally {
      history.close();
      await factory.close();
    }
  });

  it("rejects an order key larger than Datastore can index without truncation", async () => {
    const client = new Datastore({ projectId: `spine-agent-long-${randomUUID()}` });
    const factory = DatastoreStorageFactory.newBuilder().setClient(client).build();
    const history = AgentHistoryStorageFactories.create(factory, scope);
    try {
      await expect(
        history.append("long-id", event("a".repeat(1000), occurredAt(6n), false)),
      ).rejects.toThrow("indexed-value limit");
    } finally {
      history.close();
      await factory.close();
    }
  });
});
