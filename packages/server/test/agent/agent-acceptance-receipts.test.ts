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

import { clone, create } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { Datastore } from "@google-cloud/datastore";
import { randomUUID } from "node:crypto";
import { AnyPacker, StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { CommandIdSchema, EventIdSchema, TenantIdSchema } from "@spine-event-engine/proto";
import {
  InMemoryStorageBackend,
  InMemoryStorageFactory,
  type StorageContext,
  type StorageFactory,
} from "@spine-event-engine/storage";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import { MysqlStorageFactory } from "@spine-event-engine/storage-mysql";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import { StoragePreparations } from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";
import {
  AgentAcceptanceKeySchema,
  AgentAcceptanceReceiptSchema,
} from "@spine-event-engine/proto/generated/spine/server/agent/acceptance_receipt_pb.js";

import {
  AgentAcceptanceReceipts,
  agentAcceptanceReceiptGroup,
  agentAcceptanceReceiptSpec,
} from "../../src/agent/agent-acceptance-receipts.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
  SupportReplyReviewAgentStateSchema,
} from "../../test-fixtures/generated/entity-metadata/support_agent_states_pb.js";

const backend = () => new InMemoryStorageBackend();
const context = (tenant: string) => ({
  name: "support",
  multitenant: true as const,
  tenantId: create(TenantIdSchema, { kind: { case: "value", value: tenant } }),
});
const input = (ticket: string) => ({
  stateType: SupportReplyAgentStateSchema.typeName,
  recipientId: AnyPacker.pack(
    SupportReplyAgentIdSchema,
    create(SupportReplyAgentIdSchema, { ticketNumber: ticket }),
  ),
  source: { kind: "command" as const, id: create(CommandIdSchema, { uuid: "source-1" }) },
  action: "HANDLE_COMMAND" as const,
});
const receiptFor = (request: ReturnType<typeof input>) =>
  create(AgentAcceptanceReceiptSchema, {
    key: create(AgentAcceptanceKeySchema, {
      stateType: request.stateType,
      recipientId: request.recipientId,
      source: { case: "command", value: request.source.id },
      action: request.action,
    }),
  });

async function exerciseProvider(
  firstFactory: StorageFactory,
  secondFactory: StorageFactory,
  a: StorageContext,
  b: StorageContext,
  ticket: string,
): Promise<void> {
  const source = { kind: "command" as const, id: create(CommandIdSchema, { uuid: randomUUID() }) };
  const request = { ...input(ticket), source };
  request.recipientId.typeUrl = `custom/${SupportReplyAgentIdSchema.typeName}`;
  const first = new AgentAcceptanceReceipts(firstFactory);
  const second = new AgentAcceptanceReceipts(secondFactory);
  try {
    const outcomes = await Promise.all([first.accept(a, request), second.accept(a, request)]);
    expect(outcomes.sort()).toEqual([false, true]);
    expect(await first.accept(b, request)).toBe(true);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
  const reopened = new AgentAcceptanceReceipts(secondFactory);
  try {
    expect(await reopened.accept(a, request)).toBe(false);
  } finally {
    await reopened.close();
  }
}

describe("Agent acceptance receipts", () => {
  it("permits one acceptance across independent handles and retains evidence after reopen", async () => {
    const shared = backend();
    const first = new AgentAcceptanceReceipts(new InMemoryStorageFactory(shared));
    const second = new AgentAcceptanceReceipts(new InMemoryStorageFactory(shared));
    const selected = await Promise.all([
      first.accept(context("A"), input("T-1")),
      second.accept(context("A"), input("T-1")),
    ]);
    expect(selected.sort()).toEqual([false, true]);
    expect(await first.accept(context("A"), input("T-2"))).toBe(true);
    expect(await first.accept(context("B"), input("T-1"))).toBe(true);
    await Promise.all([first.close(), second.close()]);
    const reopened = new AgentAcceptanceReceipts(new InMemoryStorageFactory(shared));
    expect(await reopened.accept(context("A"), input("T-1"))).toBe(false);
    await reopened.close();
  });

  it("separates generated state, typed source, and delivery action", async () => {
    const receipts = new AgentAcceptanceReceipts(new InMemoryStorageFactory());
    const base = input("T-1");
    expect(await receipts.accept(context("A"), base)).toBe(true);
    expect(
      await receipts.accept(context("A"), {
        ...base,
        stateType: SupportReplyReviewAgentStateSchema.typeName,
      }),
    ).toBe(true);
    const event = {
      ...base,
      source: { kind: "event" as const, id: create(EventIdSchema, { value: "source-1" }) },
      action: "REACT_UPON_EVENT" as const,
    };
    expect(await receipts.accept(context("A"), event)).toBe(true);
    expect(
      await receipts.accept(context("A"), {
        ...event,
        action: "UPDATE_SUBSCRIBER",
      }),
    ).toBe(true);
    expect(
      await receipts.accept(context("A"), {
        ...base,
        source: { kind: "command", id: create(CommandIdSchema, { uuid: "source-2" }) },
      }),
    ).toBe(true);
    await receipts.close();
  });

  it("derives a stable v1 slot from exact typed fields and escaped identifier text", () => {
    const supplied = input('T-☃"/,');
    supplied.recipientId.typeUrl = `custom/${SupportReplyAgentIdSchema.typeName}`;
    const key = create(AgentAcceptanceKeySchema, {
      stateType: supplied.stateType,
      recipientId: supplied.recipientId,
      source: { case: "command", value: supplied.source.id },
      action: supplied.action,
    });
    const receipt = create(AgentAcceptanceReceiptSchema, { key });
    expect(agentAcceptanceReceiptSpec.idValueIn(receipt)).toBe(
      "v1:e5a66e4a75d882ada75262046a732b392164772b95062dbc55b227eeb557259f",
    );
  });

  it("stores complete recipient bytes and distinguishes equal bytes under distinct Any URLs", async () => {
    const factory = new InMemoryStorageFactory();
    const receipts = new AgentAcceptanceReceipts(factory);
    const first = input("T-opaque");
    const second = {
      ...first,
      recipientId: create(AnySchema, {
        typeUrl: `custom/${SupportReplyAgentIdSchema.typeName}`,
        value: Uint8Array.from(first.recipientId.value),
      }),
    };
    expect(await receipts.accept(context("A"), first)).toBe(true);
    expect(await receipts.accept(context("A"), second)).toBe(true);
    const records = factory.createRecordStorage(
      context("A"),
      agentAcceptanceReceiptSpec,
      agentAcceptanceReceiptGroup,
    );
    try {
      const slots = await records.index();
      expect(slots).toHaveLength(2);
      expect(slots.every((slot) => /^v1:[a-f0-9]{64}$/.test(slot))).toBe(true);
      const stored = await Promise.all(slots.map((slot) => records.read(slot)));
      expect(stored.map((record) => record?.key?.recipientId?.typeUrl).sort()).toEqual(
        [first.recipientId.typeUrl, second.recipientId.typeUrl].sort(),
      );
      expect(stored.map((record) => record?.key?.recipientId?.value)).toEqual([
        first.recipientId.value,
        second.recipientId.value,
      ]);
    } finally {
      records.close();
      await receipts.close();
    }
  });

  it("never grants permission after a CAS write that reports an error", async () => {
    const shared = backend();
    const factory = new InMemoryStorageFactory(shared);
    const createStorage = factory.createRecordStorage.bind(factory);
    const failure = new Error("provider reported an uncertain write");
    vi.spyOn(factory, "createRecordStorage").mockImplementation((scope, spec, group) => {
      const storage = createStorage(scope, spec, group);
      const compare = storage.compareAndSet.bind(storage);
      vi.spyOn(storage, "compareAndSet").mockImplementation(async (id, expected, next) => {
        await compare(id, expected, next);
        throw failure;
      });
      return storage;
    });
    const receipts = new AgentAcceptanceReceipts(factory);
    await expect(receipts.accept(context("A"), input("T-1"))).rejects.toBe(failure);
    await receipts.close();
    const reopened = new AgentAcceptanceReceipts(new InMemoryStorageFactory(shared));
    expect(await reopened.accept(context("A"), input("T-1"))).toBe(false);
    await reopened.close();
  });

  it.each([
    ["different identity", receiptFor(input("T-other")), /identity conflict/],
    ["missing evidence", undefined, /missing after lost CAS/],
    [
      "malformed present identity",
      create(AgentAcceptanceReceiptSchema, {
        key: create(AgentAcceptanceKeySchema, {
          stateType: SupportReplyAgentStateSchema.typeName,
          recipientId: input("T-1").recipientId,
          action: "HANDLE_COMMAND",
        }),
      }),
      /incomplete identity/,
    ],
  ])("fails closed after lost CAS with %s", async (_case, existing, error) => {
    const factory = new InMemoryStorageFactory();
    const createStorage = factory.createRecordStorage.bind(factory);
    let comparisons = 0;
    vi.spyOn(factory, "createRecordStorage").mockImplementation((scope, spec, group) => {
      const storage = createStorage(scope, spec, group);
      vi.spyOn(storage, "compareAndSet").mockImplementation(() => {
        comparisons++;
        return Promise.resolve(false);
      });
      vi.spyOn(storage, "read").mockResolvedValue(existing);
      return storage;
    });
    const receipts = new AgentAcceptanceReceipts(factory);
    await expect(receipts.accept(context("A"), input("T-1"))).rejects.toThrow(error);
    expect(comparisons).toBe(1);
    await receipts.close();
  });

  it("preserves verification-read failure without retrying CAS", async () => {
    const factory = new InMemoryStorageFactory();
    const createStorage = factory.createRecordStorage.bind(factory);
    const failure = new Error("receipt read failed");
    let comparisons = 0;
    vi.spyOn(factory, "createRecordStorage").mockImplementation((scope, spec, group) => {
      const storage = createStorage(scope, spec, group);
      vi.spyOn(storage, "compareAndSet").mockImplementation(() => {
        comparisons++;
        return Promise.resolve(false);
      });
      vi.spyOn(storage, "read").mockRejectedValue(failure);
      return storage;
    });
    const receipts = new AgentAcceptanceReceipts(factory);
    await expect(receipts.accept(context("A"), input("T-1"))).rejects.toBe(failure);
    expect(comparisons).toBe(1);
    await receipts.close();
  });

  it("captures Any and source bytes before a gated verification read and drains it", async () => {
    const factory = new InMemoryStorageFactory();
    const createStorage = factory.createRecordStorage.bind(factory);
    const request = input("T-1");
    request.recipientId.typeUrl = `custom/${SupportReplyAgentIdSchema.typeName}`;
    const expected = clone(AgentAcceptanceReceiptSchema, receiptFor(request));
    let startRead!: () => void;
    let release!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      startRead = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let open = () => false;
    vi.spyOn(factory, "createRecordStorage").mockImplementation((scope, spec, group) => {
      const storage = createStorage(scope, spec, group);
      open = () => storage.isOpen();
      vi.spyOn(storage, "compareAndSet").mockResolvedValue(false);
      vi.spyOn(storage, "read").mockImplementation(async () => {
        startRead();
        await gate;
        return expected;
      });
      return storage;
    });
    const receipts = new AgentAcceptanceReceipts(factory);
    const accepted = receipts.accept(context("A"), request);
    await readStarted;
    const closing = receipts.close();
    request.recipientId.typeUrl = "mutated/Recipient";
    request.recipientId.value.fill(0);
    request.source.id.uuid = "mutated-source";
    expect(open()).toBe(true);
    release();
    expect(await accepted).toBe(false);
    await closing;
    expect(open()).toBe(false);
    expect(expected.key?.recipientId?.typeUrl).toBe(`custom/${SupportReplyAgentIdSchema.typeName}`);
    expect(expected.key?.recipientId?.value).not.toEqual(request.recipientId.value);
  });

  it("rejects a provider without atomic compare-and-set", async () => {
    const factory = new InMemoryStorageFactory();
    const createStorage = factory.createRecordStorage.bind(factory);
    vi.spyOn(factory, "createRecordStorage").mockImplementation((scope, spec, group) => {
      const storage = createStorage(scope, spec, group);
      Object.defineProperty(storage, "atomicCompareAndSet", { value: false });
      return storage;
    });
    const receipts = new AgentAcceptanceReceipts(factory);
    await expect(receipts.accept(context("A"), input("T-1"))).rejects.toThrow(/atomic/);
    await receipts.close();
  });

  it("rejects incomplete typed identity before opening a provider handle", async () => {
    const factory = new InMemoryStorageFactory();
    const opened = vi.spyOn(factory, "createRecordStorage");
    const receipts = new AgentAcceptanceReceipts(factory);
    await expect(
      receipts.accept(context("A"), {
        ...input("T-1"),
        stateType: " ",
      }),
    ).rejects.toThrow(/state type/);
    await expect(
      receipts.accept(context("A"), {
        ...input("T-1"),
        source: { kind: "command", id: create(CommandIdSchema) },
      }),
    ).rejects.toThrow(/incomplete identity/);
    expect(opened).not.toHaveBeenCalled();
    await receipts.close();
  });

  it("fences new admissions and drains an admitted CAS before closing its handle", async () => {
    const factory = new InMemoryStorageFactory();
    const createStorage = factory.createRecordStorage.bind(factory);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const closes: (() => boolean)[] = [];
    vi.spyOn(factory, "createRecordStorage").mockImplementation((scope, spec, group) => {
      const storage = createStorage(scope, spec, group);
      const compare = storage.compareAndSet.bind(storage);
      vi.spyOn(storage, "compareAndSet").mockImplementation(async (id, expected, next) => {
        await gate;
        return compare(id, expected, next);
      });
      closes.push(() => storage.isOpen());
      return storage;
    });
    const receipts = new AgentAcceptanceReceipts(factory);
    const accepted = receipts.accept(context("A"), input("T-1"));
    const closing = receipts.close();
    expect(closes[0]?.()).toBe(true);
    await expect(receipts.accept(context("A"), input("T-2"))).rejects.toThrow(/closed/);
    release();
    expect(await accepted).toBe(true);
    await closing;
    expect(closes[0]?.()).toBe(false);
    expect(receipts.close()).toBe(closing);
  });

  it("attempts every retained handle close and records the same cleanup failure", async () => {
    const factory = new InMemoryStorageFactory();
    const createStorage = factory.createRecordStorage.bind(factory);
    const failures = [new Error("first close"), new Error("second close")];
    const closes = [vi.fn(), vi.fn()];
    vi.spyOn(factory, "createRecordStorage").mockImplementation((scope, spec, group) => {
      const storage = createStorage(scope, spec, group);
      const index = scope.multitenant && scope.tenantId.kind.value === "A" ? 0 : 1;
      vi.spyOn(storage, "close").mockImplementation(() => {
        closes[index]?.();
        throw failures[index] ?? new Error("Missing close failure fixture.");
      });
      return storage;
    });
    const receipts = new AgentAcceptanceReceipts(factory);
    await receipts.accept(context("A"), input("T-1"));
    await receipts.accept(context("B"), input("T-1"));
    const closing = receipts.close();
    await expect(closing).rejects.toMatchObject({ errors: failures });
    expect(receipts.close()).toBe(closing);
    expect(closes.map((close) => close.mock.calls.length)).toEqual([1, 1]);
  });

  it.skipIf(process.env.SPINE_TS_POSTGRESQL_URL === undefined)(
    "retains a prepared receipt across PostgreSQL factory reopen",
    async () => {
      const url = process.env.SPINE_TS_POSTGRESQL_URL;
      if (url === undefined) throw new Error("PostgreSQL URL is required for this test.");
      const stringifiers = new StringifierRegistry();
      stringifiers.setTypeRegistry(new TypeRegistry([SupportReplyAgentIdSchema]));
      const scope = { name: "support", multitenant: false as const };
      const source = {
        kind: "command" as const,
        id: create(CommandIdSchema, { uuid: randomUUID() }),
      };
      const firstFactory = await PostgresStorageFactory.newBuilder()
        .setOptions({ url })
        .setStringifierRegistry(stringifiers)
        .build();
      try {
        await StoragePreparations.for(firstFactory).prepareRecord(
          scope,
          agentAcceptanceReceiptSpec,
          agentAcceptanceReceiptGroup,
          "create",
        );
        const first = new AgentAcceptanceReceipts(firstFactory);
        expect(await first.accept(scope, { ...input("T-live"), source })).toBe(true);
        await first.close();
      } finally {
        await firstFactory.close();
      }
      const secondFactory = await PostgresStorageFactory.newBuilder()
        .setOptions({ url })
        .setStringifierRegistry(stringifiers)
        .build();
      try {
        const second = new AgentAcceptanceReceipts(secondFactory);
        expect(await second.accept(scope, { ...input("T-live"), source })).toBe(false);
        await second.close();
      } finally {
        await secondFactory.close();
      }
    },
  );

  it.skipIf(process.env.SPINE_TS_POSTGRESQL_URL === undefined)(
    "accepts a typed recipient within the ordinary PostgreSQL Entity ID bound",
    async () => {
      const url = process.env.SPINE_TS_POSTGRESQL_URL;
      if (url === undefined) throw new Error("PostgreSQL URL is required for this test.");
      const stringifiers = new StringifierRegistry();
      stringifiers.setTypeRegistry(new TypeRegistry([SupportReplyAgentIdSchema]));
      const id = create(SupportReplyAgentIdSchema, { ticketNumber: `T-${"x".repeat(350)}` });
      expect(stringifiers.forMessage(SupportReplyAgentIdSchema).toString(id).length).toBeLessThan(
        512,
      );
      const accepted = {
        ...input("T-long"),
        recipientId: AnyPacker.pack(SupportReplyAgentIdSchema, id),
      };
      const factory = await PostgresStorageFactory.newBuilder()
        .setOptions({ url })
        .setStringifierRegistry(stringifiers)
        .build();
      try {
        const receipts = new AgentAcceptanceReceipts(factory);
        expect(
          await receipts.accept(
            { name: "support", multitenant: false },
            {
              ...accepted,
              source: { kind: "command", id: create(CommandIdSchema, { uuid: randomUUID() }) },
            },
          ),
        ).toBe(true);
        await receipts.close();
      } finally {
        await factory.close();
      }
    },
  );

  it.skipIf(
    !process.env.SPINE_TS_POSTGRESQL_URL ||
      !process.env.SPINE_TS_POSTGRESQL_TENANT_A_URL ||
      !process.env.SPINE_TS_POSTGRESQL_TENANT_B_URL,
  )("races independent PostgreSQL handles and separates complete tenants", async () => {
    const url = process.env.SPINE_TS_POSTGRESQL_URL;
    const aUrl = process.env.SPINE_TS_POSTGRESQL_TENANT_A_URL;
    const bUrl = process.env.SPINE_TS_POSTGRESQL_TENANT_B_URL;
    if (!url || !aUrl || !bUrl) throw new Error("PostgreSQL tenant URLs are required.");
    const builder = () =>
      PostgresStorageFactory.newBuilder()
        .setOptions({ url })
        .setTenantOptions([
          { tenantId: context("A").tenantId, options: { url: aUrl } },
          { tenantId: context("B").tenantId, options: { url: bUrl } },
        ])
        .build();
    const first = await builder();
    const second = await builder();
    try {
      await exerciseProvider(first, second, context("A"), context("B"), "T-pg");
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });

  it.skipIf(
    !process.env.SPINE_TS_MYSQL_URL ||
      !process.env.SPINE_TS_MYSQL_TENANT_A_URL ||
      !process.env.SPINE_TS_MYSQL_TENANT_B_URL,
  )("races independent MySQL handles with long Agent IDs and separate tenants", async () => {
    const url = process.env.SPINE_TS_MYSQL_URL;
    const aUrl = process.env.SPINE_TS_MYSQL_TENANT_A_URL;
    const bUrl = process.env.SPINE_TS_MYSQL_TENANT_B_URL;
    if (!url || !aUrl || !bUrl) throw new Error("MySQL tenant URLs are required.");
    const builder = () =>
      MysqlStorageFactory.newBuilder()
        .setOptions({ url })
        .setTenantOptions([
          { tenantId: context("A").tenantId, options: { url: aUrl } },
          { tenantId: context("B").tenantId, options: { url: bUrl } },
        ])
        .build();
    const first = await builder();
    const second = await builder();
    try {
      await exerciseProvider(first, second, context("A"), context("B"), `T-${"x".repeat(350)}`);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });

  it.skipIf(process.env.DATASTORE_EMULATOR_HOST === undefined)(
    "races independent Datastore handles and separates complete tenants",
    async () => {
      const projectId = process.env.DATASTORE_PROJECT_ID ?? "spine-env-lifecycle-datastore";
      const builder = () =>
        DatastoreStorageFactory.newBuilder().setClient(new Datastore({ projectId })).build();
      const first = builder();
      const second = builder();
      try {
        await exerciseProvider(first, second, context("A"), context("B"), "T-datastore");
      } finally {
        await Promise.all([first.close(), second.close()]);
      }
    },
  );
});
