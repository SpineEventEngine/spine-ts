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
import { AnyPacker, TypeUrls } from "@spine-event-engine/core";
import { CommandIdSchema, CommandSchema } from "@spine-event-engine/proto";
import { CreateTaskSchema } from "../../../examples/todo/generated/spine/examples/todo/task_commands_pb.js";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import { TaskSchema } from "../../../examples/todo/generated/spine/examples/todo/tasks_pb.js";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { afterEach, expect, it } from "vitest";
import { DeliveryServer } from "@spine-event-engine/delivery-server";
import {
  Health,
  InboxService,
  WriteMessageSchema,
} from "@spine-event-engine/proto/delivery-server";
import {
  InboxLabel,
  InboxMessageSchema,
  InboxMessageStatus,
  ShardIndexSchema,
} from "@spine-event-engine/proto/delivery";
import { DeliveryClient } from "../src/client/client.js";

const servers: DeliveryServer[] = [];
const clients: DeliveryClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

it("streams a free pending shard to each real gRPC client and advertises service health", async () => {
  const server = new DeliveryServer({ port: 0 });
  servers.push(server);
  await server.start();
  const first = DeliveryClient.connectTo(server.baseUrl);
  const second = DeliveryClient.connectTo(server.baseUrl);
  clients.push(first, second);
  const one = first.observeAvailableShards()[Symbol.asyncIterator]();
  const two = second.observeAvailableShards()[Symbol.asyncIterator]();
  const pendingOne = one.next();
  const pendingTwo = two.next();
  const sessions = new Http2SessionManager(server.baseUrl);
  const transport = createGrpcTransport({ baseUrl: server.baseUrl, sessionManager: sessions });
  try {
    await expect(
      createClient(Health, transport).check({
        service: "spine.delivery.ShardObservingService",
      }),
    ).resolves.toMatchObject({ status: 1 });
    const shard = create(ShardIndexSchema, { index: 2, ofTotal: 4 });
    const taskId = create(TaskIdSchema, { value: "task-1" });
    const command = create(CommandSchema, {
      id: create(CommandIdSchema, { uuid: "command-1" }),
      message: AnyPacker.pack(
        CreateTaskSchema,
        create(CreateTaskSchema, {
          id: taskId,
          taskListId: create(TaskListIdSchema, { value: "list-1" }),
          title: "Observe delivery",
        }),
      ),
    });
    await createClient(InboxService, transport).writeOne(
      create(WriteMessageSchema, {
        message: create(InboxMessageSchema, {
          id: { uuid: "one", index: shard },
          signalId: { value: "signal" },
          inboxId: {
            entityId: { id: AnyPacker.pack(TaskIdSchema, taskId) },
            typeUrl: TypeUrls.derive(TaskSchema),
          },
          payload: { case: "command", value: command },
          label: InboxLabel.HANDLE_COMMAND,
          whenReceived: { seconds: 0n, nanos: 0 },
          status: InboxMessageStatus.TO_DELIVER,
        }),
      }),
    );
    await expect(pendingOne).resolves.toMatchObject({ value: { index: 2, ofTotal: 4 } });
    await expect(pendingTwo).resolves.toMatchObject({ value: { index: 2, ofTotal: 4 } });
  } finally {
    await one.return?.();
    await two.return?.();
    sessions.abort();
  }
});
