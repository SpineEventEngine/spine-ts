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

/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { EventIdSchema, EventSchema } from "@spine-event-engine/proto";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { EntityCommitStorageFactories } from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({
  current: undefined,
  calls: [] as string[],
  transactional: true,
  close: vi.fn(),
}));

vi.mock("mysql2/promise", () => ({
  createPool: vi.fn(() => ({
    getConnection: () =>
      Promise.resolve({
        query: () => Promise.resolve([[], []]),
        release: () => undefined,
      }),
    end: () => Promise.resolve(),
  })),
}));
vi.mock("../src/mysql/entity-history.js", () => ({
  MysqlEntityStorage: class {
    current = { write: async () => seam.calls.push("write") };
    commitCapability() {
      return {
        prepare: async () => seam.calls.push("families.prepare"),
        tableNames: () => ["current"],
        withConnection: (_: unknown, run: () => unknown) => run(),
        readCurrentLocked: async () => seam.current,
        preflightImmutable: async () => seam.calls.push("preflight"),
        appendStateImmutable: async () => seam.calls.push("state"),
        appendDiagnosticImmutable: async () => seam.calls.push("diagnostic"),
      };
    }
    close() {
      seam.close();
    }
  },
}));
vi.mock("../src/mysql/record-storage.js", () => ({
  MysqlRecordStorage: class {
    tableName = "events";
    prepare = async () => seam.calls.push("events.prepare");
    withConnection = (_: unknown, run: () => unknown) => run();
    assertImmutable = async () => seam.calls.push("assert");
    writeImmutable = async () => seam.calls.push("event");
    close = () => seam.close();
  },
}));
vi.mock("../src/mysql/entity-commit.js", () => ({
  mysqlEntityLockKey: () => "lock",
  MysqlEntityCommitCoordinator: class {
    commit = async (
      _: unknown,
      _key: string,
      work: (c: unknown, transactional: boolean) => unknown,
    ) => work({}, seam.transactional);
  },
}));

import { MysqlStorageFactory } from "../src/index.js";

describe("MysqlStorageFactory mocked entity commits", () => {
  it.each([true, false])(
    "persists commit families through the public factory (%s transaction)",
    async (transactional) => {
      seam.calls = [];
      seam.current = undefined;
      seam.transactional = transactional;
      seam.close.mockClear();
      const factory = await MysqlStorageFactory.newBuilder()
        .setOptions({ url: "mysql://db.example/commit_mock" })
        .build();
      const context = { name: "orders", multitenant: false } as const;
      const entity = {
        context,
        id: { key: (id: string) => id },
        columns: [],
        sourceType: StringValueSchema,
        stateSchema: StringValueSchema,
        stateHistory: true,
        eventHistory: true,
      } as never;
      const commits = EntityCommitStorageFactories.create(factory, entity);
      const next = create(EntityRecordSchema);
      await expect(
        commits.commit({
          context,
          entity,
          entityId: "order-1",
          next,
          states: [next],
          diagnostics: [create(EventSchema)],
          events: [create(EventSchema, { id: create(EventIdSchema, { value: "event-1" }) })],
        }),
      ).resolves.toBe("committed");
      expect(seam.calls).toEqual(
        transactional
          ? ["families.prepare", "events.prepare", "state", "diagnostic", "event", "write"]
          : [
              "families.prepare",
              "events.prepare",
              "preflight",
              "assert",
              "state",
              "diagnostic",
              "event",
              "write",
            ],
      );
      commits.close();
      commits.close();
      expect(seam.close).toHaveBeenCalledTimes(2);
      factory.close();
    },
  );
});
