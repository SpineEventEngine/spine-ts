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
import { AnyMessages, Time, TypeUrls, type TimeProvider } from "@spine-event-engine/core";
import {
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  UserIdSchema,
} from "@spine-event-engine/proto";
import { DeliveryServer } from "@spine-event-engine/delivery-server";
import { ShardIndex, type InboxMessage } from "@spine-event-engine/server";
import { afterEach, beforeEach, expect, it } from "vitest";

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
let priorTimeProvider: TimeProvider | undefined;

beforeEach(() => {
  let microseconds = 0;
  priorTimeProvider = Time.setProvider({
    currentTime: () => create(TimestampSchema, { seconds: 1n, nanos: microseconds++ * 1_000 }),
  });
});

afterEach(async () => {
  try {
    for (const client of clients.splice(0)) client.close();
    for (const server of servers.splice(0)) await server.close();
  } finally {
    if (priorTimeProvider !== undefined) Time.setProvider(priorTimeProvider);
    priorTimeProvider = undefined;
  }
});

it("continues more than one JVM timestamp page over the real InboxService", async () => {
  const server = new DeliveryServer({ host: "127.0.0.1", port: 0 });
  servers.push(server);
  await server.start();
  const client = DeliveryClient.connectTo(server.baseUrl, { pageSize: 100 });
  clients.push(client);
  const inbox = new RemoteInbox(client);
  const rows = Array.from({ length: 201 }, (_, index) => projectionMessage(index));
  for (let index = 0; index < rows.length; index += 100)
    await client.writeMany(rows.slice(index, index + 100));

  const first = await client.readPage(ShardIndex.single(), { pageSize: 100 });
  expect(first).toHaveLength(100);
  const anchor = first.at(-1);
  if (anchor === undefined) throw new Error("Expected a full first Inbox page.");
  const next = await client.readPage(ShardIndex.single(), {
    pageSize: 100,
    sinceWhen: anchor.whenReceived,
  });
  expect(next[0]?.id.value).toBe("projection-0100");
  expect(
    (await inbox.read(ShardIndex.single(), { limit: 201 })).map((row) => row.id.value),
  ).toEqual(rows.map((row) => row.id.value));
}, 20_000);

it("advances through full excluded-status pages using received timestamps", async () => {
  const server = new DeliveryServer({ host: "127.0.0.1", port: 0 });
  servers.push(server);
  await server.start();
  const client = DeliveryClient.connectTo(server.baseUrl, { pageSize: 2 });
  clients.push(client);
  const inbox = new RemoteInbox(client);
  const rows = Array.from({ length: 5 }, (_, index) => ({
    ...projectionMessage(index + 2_000),
    status: index === 4 ? ("TO_DELIVER" as const) : ("DELIVERED" as const),
  }));
  await client.writeMany(rows);
  expect(
    (await inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] })).map(
      (row) => row.id.value,
    ),
  ).toEqual([rows[4]?.id.value]);
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
    whenReceived: Time.currentTime(),
    version: 0n,
  };
}
