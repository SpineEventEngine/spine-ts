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

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport, createGrpcWebTransport } from "@connectrpc/connect-web";
import { Client } from "@spine-event-engine/client-web";
import { TypeUrls, AnyMessages } from "@spine-event-engine/core";
import { ActorContextSchema, TenantIdSchema, UserIdSchema } from "@spine-event-engine/proto";
import {
  CompositeFilterSchema,
  CompositeFilter_CompositeOperator,
  FilterSchema,
  Filter_Operator,
  QuerySchema,
  SubscriptionSchema,
  SubscriptionService,
  TargetFiltersSchema,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { PostMessageSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/commands_pb.js";
import {
  BoardMessageViewSchema,
  BoardIdSchema,
  MessageIdSchema,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { UserIdSchema as BoardUserIdSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/user_pb.js";

const parameters = new URLSearchParams(location.search);
const baseUrl = parameters.get("baseUrl");
if (baseUrl === null) throw new Error("baseUrl is required");
const protocol = parameters.get("protocol") ?? "grpc-web";
if (protocol !== "connect" && protocol !== "grpc-web")
  throw new Error("protocol must be connect or grpc-web");
const actor = parameters.get("actor") ?? "ada";
const tenant = parameters.get("tenant");
const board = parameters.get("board") ?? "general";
const messageIdPrefix = parameters.get("messageIdPrefix") ?? crypto.randomUUID();

const createBrowserTransport =
  protocol === "connect" ? createConnectTransport : createGrpcWebTransport;
const wireSubscriptions = createClient(
  SubscriptionService,
  createBrowserTransport({ baseUrl }),
);
const client = (
  protocol === "connect" ? Client.forConnect.bind(Client) : Client.forGrpcWeb.bind(Client)
)(baseUrl, { ...(tenant === null ? {} : { tenant }) });
const request = client.onBehalfOf(actor);
const query = create(QuerySchema, {
  target: create(TargetSchema, {
    type: TypeUrls.derive(BoardMessageViewSchema),
    criterion: {
      case: "filters",
      value: create(TargetFiltersSchema, {
        filter: [
          create(CompositeFilterSchema, {
            operator: CompositeFilter_CompositeOperator.ALL,
            filter: [
              create(FilterSchema, {
                fieldPath: { fieldName: ["board"] },
                operator: Filter_Operator.EQUAL,
                value: AnyMessages.pack(BoardIdSchema, create(BoardIdSchema, { value: board })),
              }),
            ],
          }),
        ],
      }),
    },
  }),
});
const topic = create(TopicSchema, {
  id: create(TopicIdSchema, { value: "browser-general" }),
  target: query.target,
  context: create(ActorContextSchema, {
    actor: create(UserIdSchema, { value: actor }),
    ...(tenant === null
      ? {}
      : { tenantId: create(TenantIdSchema, { kind: { case: "value", value: tenant } }) }),
  }),
});
let sequence = 0;
let passiveSubscription: Awaited<ReturnType<typeof request.createSubscription>> | undefined;
let passiveUpdates: AsyncIterator<unknown> | undefined;
const bigintAsString = (_key: string, value: unknown): unknown =>
  typeof value === "bigint" ? value.toString() : value;

const resolveContext = async () => ({ actor });

const createPublicSubscription = async () =>
  Array.from(toBinary(SubscriptionSchema, await wireSubscriptions.subscribe(topic)));
const activatePublicSubscription = async (bytes: readonly number[]) => {
  const updates = wireSubscriptions.activate(fromBinary(SubscriptionSchema, new Uint8Array(bytes)));
  await updates[Symbol.asyncIterator]().next();
};
const cancelPublicSubscription = (bytes: readonly number[]) =>
  wireSubscriptions.cancel(fromBinary(SubscriptionSchema, new Uint8Array(bytes)));
const startActiveSubscription = async () => {
  const subscription = await request.createSubscription(topic, {
    kind: "entity",
    authoritativeQuery: () => query,
  });
  await subscription.activate();
  const updates = subscription.updates[Symbol.asyncIterator]();
  const next = updates.next();
  for (let probe = 0; probe < 10; probe += 1) {
    await post();
    const update = await Promise.race([
      next,
      new Promise<undefined>((resolve) => setTimeout(resolve, 200)),
    ]);
    if (update !== undefined && !update.done) return true;
  }
  throw new Error("active subscription did not receive an update");
};

const post = () =>
  request.post(
    PostMessageSchema,
    create(PostMessageSchema, {
      id: create(MessageIdSchema, {
        value: `browser-interop-${messageIdPrefix}-${String(++sequence)}`,
      }),
      board: create(BoardIdSchema, { value: board }),
      author: create(BoardUserIdSchema, { value: "ada" }),
      username: "Ada",
      text: "browser",
      postedAt: create(TimestampSchema, { seconds: BigInt(sequence) }),
    }),
  );

const subscribe = async () => {
  const subscription = await request.createSubscription(topic, {
    kind: "entity",
    authoritativeQuery: () => query,
  });
  await subscription.activate();
  const updates = subscription.updates[Symbol.asyncIterator]();
  try {
    const next = updates.next();
    for (let probe = 0; probe < 10; probe += 1) {
      await post();
      const update = await Promise.race([
        next,
        new Promise<undefined>((resolve) => setTimeout(resolve, 200)),
      ]);
      if (update !== undefined) return update;
    }
    throw new Error("subscription update timeout");
  } finally {
    await updates.return?.();
    await subscription.cancel();
    await client.close();
  }
};

const startPassiveSubscription = async () => {
  if (passiveSubscription !== undefined) throw new Error("passive subscription is already active");
  passiveSubscription = await request.createSubscription(topic, {
    kind: "entity",
    authoritativeQuery: () => query,
  });
  await passiveSubscription.activate();
  passiveUpdates = passiveSubscription.updates[Symbol.asyncIterator]();
};
const nextPassiveUpdate = async () => {
  if (passiveUpdates === undefined) throw new Error("passive subscription is not active");
  const update = await passiveUpdates.next();
  return {
    done: update.done === true,
    identity: JSON.stringify(update.value, bigintAsString),
  };
};
const stopPassiveSubscription = async () => {
  const updates = passiveUpdates;
  const subscription = passiveSubscription;
  passiveUpdates = undefined;
  passiveSubscription = undefined;
  await updates?.return?.();
  await subscription?.cancel();
  await client.close();
};

Object.assign(window, {
  interopProtocol: protocol,
  interopClient: request,
  post,
  read: () => request.send(query),
  resolveContext,
  createPublicSubscription,
  activatePublicSubscription,
  cancelPublicSubscription,
  startActiveSubscription,
  startPassiveSubscription,
  nextPassiveUpdate,
  stopPassiveSubscription,
  subscribe,
});
