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
import { Code } from "@connectrpc/connect";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AnyMessages, TypeUrls } from "@spine-event-engine/core";
import {
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  UserIdSchema,
} from "@spine-event-engine/proto";
import { DeliveryServer } from "@spine-event-engine/delivery-server";
import { ShardIndex, type InboxMessage } from "@spine-event-engine/server";
import { afterEach, expect, it } from "vitest";

// prettier-ignore
import {
  ProjectMilestoneAddedSchema,
} from "@spine-event-engine/server-test-fixtures/generated/repository-routing/project_events_pb.js";
// prettier-ignore
import {
  ProjectMilestoneIdSchema,
} from "@spine-event-engine/server-test-fixtures/generated/repository-routing/project_identifiers_pb.js";
// prettier-ignore
import {
  ProjectMilestoneOverviewStateSchema,
} from "@spine-event-engine/server-test-fixtures/generated/repository-routing/project_states_pb.js";
import { DeliveryClient } from "../src/client/client.js";
import { RemoteInbox } from "../src/remote/adapters.js";

const servers: DeliveryServer[] = [];
const clients: DeliveryClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const server of servers.splice(0)) await server.close();
});

it("continues 1001 equal-time projection Events over the real cursor RPC after deleting a cursor row", async () => {
  const server = new DeliveryServer({ host: "127.0.0.1", port: 0 });
  servers.push(server);
  await server.start();
  const client = DeliveryClient.connectTo(server.baseUrl, { pageSize: 100 });
  clients.push(client);
  const inbox = new RemoteInbox(client);
  const rows = Array.from({ length: 1_001 }, (_, index) => projectionMessage(index));
  for (let index = 0; index < rows.length; index += 100)
    await client.writeMany(rows.slice(index, index + 100));

  const first = await client.readPage(ShardIndex.single(), { pageSize: 100 });
  expect(first).toHaveLength(100);
  const cursor = first.at(-1);
  if (cursor === undefined) throw new Error("Expected first cursor row.");
  await client.removeOne(cursor);
  const after = {
    messageId: cursor.id.value,
    whenReceived: cursor.whenReceived,
    version: cursor.version,
  };
  const next = await client.readPage(ShardIndex.single(), { pageSize: 100, after });
  expect(next).toHaveLength(100);
  expect(next[0]?.id.value).toBe("projection-0100");

  const collected: string[] = first.slice(0, -1).map((row) => row.id.value);
  let position = after;
  for (let pageNumber = 0; pageNumber < 11; pageNumber++) {
    const page = await client.readPage(ShardIndex.single(), { pageSize: 100, after: position });
    collected.push(...page.map((row) => row.id.value));
    const last = page.at(-1);
    if (last === undefined || page.length < 100) break;
    position = { messageId: last.id.value, whenReceived: last.whenReceived, version: last.version };
  }
  expect(collected).toEqual(rows.map((row) => row.id.value).filter((id) => id !== cursor.id.value));
  expect(await inbox.read(ShardIndex.single(), { limit: 1_000 })).toHaveLength(1_000);
}, 20_000);

it("orders mixed versions and UTF-8 IDs and advances past full excluded-status pages", async () => {
  const server = new DeliveryServer({ host: "127.0.0.1", port: 0 });
  servers.push(server);
  await server.start();
  const client = DeliveryClient.connectTo(server.baseUrl, { pageSize: 2 });
  clients.push(client);
  const inbox = new RemoteInbox(client);
  const time = create(TimestampSchema, { seconds: -62_135_596_800n, nanos: 1 });
  const inputs = [
    { id: "later-name-earlier-time", version: 0n, status: "DELIVERED" as const, nanos: 0 },
    { id: "é", version: 0n, status: "DELIVERED" as const, nanos: 1 },
    { id: "z", version: 0n, status: "DELIVERED" as const, nanos: 1 },
    { id: "b", version: 1n, status: "DELIVERED" as const, nanos: 1 },
    { id: "a", version: 1n, status: "DELIVERED" as const, nanos: 1 },
    { id: "c", version: 2n, status: "TO_DELIVER" as const, nanos: 1 },
  ];
  const rows = inputs.map((input, index) => ({
    ...projectionMessage(index + 2_000),
    id: { value: input.id, shard: ShardIndex.single() },
    whenReceived: input.nanos === 0 ? create(TimestampSchema, { seconds: time.seconds }) : time,
    version: input.version,
    status: input.status,
  }));
  await client.writeMany(rows);
  const expected = ["later-name-earlier-time", "z", "é", "a", "b", "c"];
  expect(
    (await client.readPage(ShardIndex.single(), { pageSize: 1 })).map((row) => row.id.value),
  ).toEqual(["later-name-earlier-time"]);
  expect(
    (await client.readPage(ShardIndex.single(), { pageSize: 1 })).map((row) => row.id.value),
  ).toEqual(["later-name-earlier-time"]);
  expect(
    (await client.readPage(ShardIndex.single(), { pageSize: 1_000 })).map((row) => row.id.value),
  ).toEqual(expected);
  expect(
    (
      await client.readPage(ShardIndex.single(), {
        sinceWhen: create(TimestampSchema, { seconds: time.seconds }),
      })
    ).map((row) => row.id.value),
  ).toEqual(expected.slice(1, 3));
  expect(
    (await inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] })).map(
      (row) => row.id.value,
    ),
  ).toEqual(["c"]);
  expect(await inbox.read(ShardIndex.single(), { statuses: [] })).toEqual([]);
}, 10_000);

it("reports an oversized page so the caller can request fewer rows", async () => {
  const server = new DeliveryServer({ host: "127.0.0.1", port: 0 });
  servers.push(server);
  await server.start();
  const client = DeliveryClient.connectTo(server.baseUrl);
  clients.push(client);
  const largeName = "p".repeat(550_000);
  const rows = Array.from({ length: 9 }, (_, index) => projectionMessage(index + 3_000, largeName));
  for (let index = 0; index < rows.length; index += 3)
    await client.writeMany(rows.slice(index, index + 3));
  await expect(client.readPage(ShardIndex.single(), { pageSize: 9 })).rejects.toMatchObject({
    code: Code.ResourceExhausted,
  });
  await expect(client.readPage(ShardIndex.single(), { pageSize: 3 })).resolves.toHaveLength(3);
}, 15_000);

function projectionMessage(index: number, name = `Project ${String(index + 1)}`): InboxMessage {
  const id = `projection-${String(index).padStart(4, "0")}`;
  const milestone = create(ProjectMilestoneIdSchema, {
    reader: create(UserIdSchema, { value: "paging-reader" }),
    number: index + 1,
  });
  const event = create(EventSchema, {
    id: create(EventIdSchema, { value: `event-${id}` }),
    message: AnyMessages.pack(
      ProjectMilestoneAddedSchema,
      create(ProjectMilestoneAddedSchema, { id: milestone, name }),
    ),
    context: create(EventContextSchema, {
      timestamp: create(TimestampSchema, { seconds: 1n }),
    }),
  });
  return {
    id: { value: id, shard: ShardIndex.single() },
    inboxId: {
      targetId: AnyMessages.pack(ProjectMilestoneIdSchema, milestone),
      targetTypeUrl: TypeUrls.derive(ProjectMilestoneOverviewStateSchema),
    },
    signalId: event.id?.value ?? "",
    signal: AnyMessages.pack(EventSchema, event, { validate: false }),
    label: "UPDATE_SUBSCRIBER",
    status: "TO_DELIVER",
    shard: ShardIndex.single(),
    whenReceived: create(TimestampSchema, { seconds: 1n }),
    version: 0n,
  };
}
