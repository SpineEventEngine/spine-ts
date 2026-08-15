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

import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it, vi } from "vitest";

import { RecordSpec } from "@spine-event-engine/storage";

import { DatastoreDeliveryCleanupStorage } from "../src/datastore/delivery-cleanup.js";

describe("DatastoreDeliveryCleanupStorage", () => {
  it("is available as the provider-owned exact-cleanup coordinator", () => {
    expect(DatastoreDeliveryCleanupStorage).toBeTypeOf("function");
  });

  it("declines cancellation before opening provider handles", async () => {
    const openStorage = vi.fn();
    const cleanup = new DatastoreDeliveryCleanupStorage(openStorage as never);

    await expect(cleanup.remove(input({ signal: { aborted: true } }))).resolves.toBe(false);
    expect(openStorage).not.toHaveBeenCalled();
  });

  it("declines an expired deadline before opening provider handles", async () => {
    const openStorage = vi.fn();
    const cleanup = new DatastoreDeliveryCleanupStorage(openStorage as never);

    await expect(cleanup.remove(input({ timeoutMs: 0 }))).resolves.toBe(false);
    expect(openStorage).not.toHaveBeenCalled();
  });

  it("rolls back when the session snapshot is not current", async () => {
    const transaction = transactionWith([entity(), entity()]);
    const cleanup = coordinator(transaction, false);

    await expect(cleanup.remove(input())).resolves.toBe(false);
    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it("rolls back a cancelled transaction before deleting the Inbox entity", async () => {
    const transaction = transactionWith([entity(), entity()]);
    const operation = { signal: { aborted: false } };
    const cleanup = coordinator(transaction, true, () => (operation.signal.aborted = true));

    await expect(cleanup.remove(input(operation))).resolves.toBe(false);
    expect(transaction.delete).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledOnce();
  });

  it("rolls back when a positive admitted deadline expires before commit", async () => {
    let active = true;
    const transaction = transactionWith([entity(), entity()]);
    const cleanup = coordinator(transaction, true, () => (active = false));

    await expect(cleanup.remove(input({ timeoutMs: 10, isActive: () => active }))).resolves.toBe(
      false,
    );
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledOnce();
  });

  it("commits only after exact current snapshots are present", async () => {
    const transaction = transactionWith([entity(), entity()]);
    const cleanup = coordinator(transaction, true);

    await expect(cleanup.remove(input())).resolves.toBe(true);
    expect(transaction.delete).toHaveBeenCalledOnce();
    expect(transaction.commit).toHaveBeenCalledOnce();
  });

  it("rolls back when the locked lease expires after the Inbox read", async () => {
    const transaction = transactionWith([entity(), entity()]);
    const cleanup = coordinator(transaction, true);
    const request = input();
    let checks = 0;
    request.session.isCurrent = () => ++checks === 1;

    await expect(cleanup.remove(request)).resolves.toBe(false);
    expect(transaction.delete).not.toHaveBeenCalled();
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledOnce();
  });

  it("rolls back when the locked lease expires after the exact delete", async () => {
    let current = true;
    const transaction = transactionWith([entity(), entity()]);
    transaction.delete.mockImplementation(() => (current = false));
    const cleanup = coordinator(transaction, true);
    const request = input();
    request.session.isCurrent = () => current;

    await expect(cleanup.remove(request)).resolves.toBe(false);
    expect(transaction.delete).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledOnce();
  });

  it("rolls back and preserves a provider failure", async () => {
    const transaction = transactionWith([]);
    transaction.run.mockRejectedValueOnce(new Error("provider unavailable"));
    const cleanup = coordinator(transaction, true);

    await expect(cleanup.remove(input())).rejects.toThrow("provider unavailable");
    expect(transaction.rollback).toHaveBeenCalledOnce();
  });

  it("rejects removal after close", async () => {
    const cleanup = coordinator(transactionWith([entity(), entity()]), true);
    cleanup.close();

    await expect(cleanup.remove(input())).rejects.toThrow("closed");
  });
});

const spec = new RecordSpec({
  sourceType: StringValueSchema,
  recordType: StringValueSchema,
  idKind: "string",
  extractId: (record) => record.value,
});
const expected = create(StringValueSchema, { value: "expected" });

function input(operation?: {
  signal?: { aborted: boolean };
  timeoutMs?: number;
  isActive?: () => boolean;
}) {
  return {
    context: { name: "cleanup", multitenant: false } as const,
    ...(operation === undefined ? {} : { operation }),
    inbox: { spec, id: "inbox", expected },
    session: {
      spec,
      id: "session",
      expected,
      isCurrent: (value: typeof expected) => value.value === expected.value,
    },
  };
}

function entity() {
  return { key: {} };
}

function transactionWith(entities: ReturnType<typeof entity>[]) {
  return {
    run: vi.fn(() => Promise.resolve()),
    get: vi.fn(() => Promise.resolve(entities.shift() === undefined ? [] : [entity()])),
    rollback: vi.fn(() => Promise.resolve()),
    delete: vi.fn(),
    commit: vi.fn(() => Promise.resolve()),
  };
}

function coordinator(
  transaction: ReturnType<typeof transactionWith>,
  current: boolean,
  onInboxEntity?: () => void,
) {
  let opened = 0;
  const storage = () => ({
    transaction: () => transaction,
    transactionEntity: () => ({ key: {} }),
    matchesTransactionEntity: () => true,
    decodeTransactionEntity: () => expected,
    close: vi.fn(),
  });
  return new DatastoreDeliveryCleanupStorage(
    vi.fn(() => {
      const result = storage();
      const inbox = opened++ === 0;
      if (inbox && onInboxEntity !== undefined)
        result.matchesTransactionEntity = () => {
          onInboxEntity();
          return true;
        };
      if (!inbox)
        result.decodeTransactionEntity = () =>
          current ? expected : create(StringValueSchema, { value: "other" });
      return result;
    }) as never,
  );
}
