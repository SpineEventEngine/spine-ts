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

import { MysqlDeliveryCleanupStorage } from "../src/mysql/delivery-cleanup.js";

describe("MysqlDeliveryCleanupStorage", () => {
  it("is available as the provider-owned exact-cleanup coordinator", () => {
    expect(MysqlDeliveryCleanupStorage).toBeTypeOf("function");
  });

  it("declines cancellation before opening provider handles", async () => {
    const openStorage = vi.fn();
    const cleanup = new MysqlDeliveryCleanupStorage(openStorage as never, vi.fn(), () => "key");

    await expect(cleanup.remove(input({ signal: { aborted: true } }))).resolves.toBe(false);
    expect(openStorage).not.toHaveBeenCalled();
  });

  it("declines an expired deadline before opening provider handles", async () => {
    const openStorage = vi.fn();
    const cleanup = new MysqlDeliveryCleanupStorage(openStorage as never, vi.fn(), () => "key");

    await expect(cleanup.remove(input({ timeoutMs: 0 }))).resolves.toBe(false);
    expect(openStorage).not.toHaveBeenCalled();
  });

  it("rechecks cancellation after preparation before entering the coordinator", async () => {
    const operation = { signal: { aborted: false } };
    const openStorage = vi.fn(() => storage(() => (operation.signal.aborted = true)));
    const coordinate = vi.fn(coordinateWork);
    const cleanup = new MysqlDeliveryCleanupStorage(
      openStorage as never,
      coordinate as never,
      () => "key",
    );

    await expect(cleanup.remove(input(operation))).resolves.toBe(false);
    expect(coordinate).not.toHaveBeenCalled();
  });

  it("keeps the row when the locked session no longer matches", async () => {
    const sessions = storage();
    sessions.readLocked.mockResolvedValue(create(StringValueSchema, { value: "other" }));
    const cleanup = coordinator(storage(), sessions);

    await expect(cleanup.remove(input())).resolves.toBe(false);
    expect(sessions.readLocked).toHaveBeenCalledOnce();
  });

  it("does not delete when a positive admitted deadline expires while locked reads are blocked", async () => {
    let active = true;
    const inbox = storage();
    const sessions = storage();
    sessions.readLocked.mockImplementation(() => {
      active = false;
      return Promise.resolve(expected);
    });
    const cleanup = coordinator(inbox, sessions);

    await expect(cleanup.remove(input({ timeoutMs: 10, isActive: () => active }))).resolves.toBe(
      false,
    );
    expect(inbox.delete).not.toHaveBeenCalled();
  });

  it("returns false when expiry is observed after delete and the coordinator rolls back", async () => {
    let active = true;
    let rolledBack = false;
    const inbox = storage();
    inbox.delete.mockImplementation(() => {
      active = false;
      return Promise.resolve(true);
    });
    const sessions = storage();
    const cleanup = new MysqlDeliveryCleanupStorage(
      vi.fn(() => (sessions.prepare.mock.calls.length === 0 ? inbox : sessions)) as never,
      async (_context, _tables, _key, work) => {
        try {
          return await work({} as never);
        } catch (error) {
          rolledBack = true;
          throw error;
        }
      },
      () => "key",
    );

    await expect(cleanup.remove(input({ timeoutMs: 10, isActive: () => active }))).resolves.toBe(
      false,
    );
    expect(inbox.delete).toHaveBeenCalledOnce();
    expect(rolledBack).toBe(true);
  });

  it("deletes only after locked snapshots and current ownership match", async () => {
    const inbox = storage();
    const sessions = storage();
    const cleanup = coordinator(inbox, sessions);

    await expect(cleanup.remove(input())).resolves.toBe(true);
    expect(inbox.delete).toHaveBeenCalledWith("inbox");
  });

  it("does not delete when the locked lease expires after the Inbox read", async () => {
    const inbox = storage();
    const sessions = storage();
    const request = input();
    let checks = 0;
    request.session.isCurrent = () => ++checks === 1;
    const cleanup = coordinator(inbox, sessions);

    await expect(cleanup.remove(request)).resolves.toBe(false);
    expect(inbox.delete).not.toHaveBeenCalled();
  });

  it("rolls back when the locked lease expires during the exact delete", async () => {
    let current = true;
    let rolledBack = false;
    const inbox = storage();
    inbox.delete.mockImplementation(() => {
      current = false;
      return Promise.resolve(true);
    });
    const sessions = storage();
    const cleanup = new MysqlDeliveryCleanupStorage(
      vi.fn(() => (sessions.prepare.mock.calls.length === 0 ? inbox : sessions)) as never,
      async (_context, _tables, _key, work) => {
        try {
          return await work({} as never);
        } catch (error) {
          rolledBack = true;
          throw error;
        }
      },
      () => "key",
    );
    const request = input();
    request.session.isCurrent = () => current;

    await expect(cleanup.remove(request)).resolves.toBe(false);
    expect(inbox.delete).toHaveBeenCalledOnce();
    expect(rolledBack).toBe(true);
  });

  it("rejects removal after close", async () => {
    const cleanup = coordinator(storage(), storage());
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
      isCurrent: (value: typeof expected) => value.value === "expected",
    },
  };
}

function storage(onPrepare?: () => void) {
  return {
    tableName: "records",
    prepare: vi.fn(() => Promise.resolve(onPrepare?.())),
    close: vi.fn(),
    withConnection: vi.fn((_connection: unknown, work: () => Promise<unknown>) => work()),
    readLocked: vi.fn(() => Promise.resolve(expected)),
    delete: vi.fn(() => Promise.resolve(true)),
  };
}

function coordinator(inbox: ReturnType<typeof storage>, sessions: ReturnType<typeof storage>) {
  let opened = 0;
  return new MysqlDeliveryCleanupStorage(
    vi.fn(() => (opened++ === 0 ? inbox : sessions)) as never,
    coordinateWork,
    () => "key",
  );
}

async function coordinateWork<T>(
  _context: unknown,
  _tables: readonly string[],
  _key: string,
  work: (connection: never) => Promise<T>,
): Promise<T> {
  return await work({} as never);
}
