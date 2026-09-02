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
import { TypeUrls } from "@spine-event-engine/core";
import { useEntitySubscription, useSubscriptionDelivery } from "@spine-event-engine/client-react";
import { BoardMessageViewSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import {
  QueryIdSchema,
  QuerySchema,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";

const target = create(TargetSchema, {
  type: TypeUrls.derive(BoardMessageViewSchema),
  criterion: { case: "includeAll", value: true },
});
const query = create(QuerySchema, { id: create(QueryIdSchema, { value: "messages" }), target });
const topic = create(TopicSchema, { id: create(TopicIdSchema, { value: "messages" }), target });

function TaskUpdates() {
  const observation = useEntitySubscription(topic, () => query, []);
  const delivery = useSubscriptionDelivery(observation);
  return `${observation.status}:${delivery?.kind ?? "none"}`;
}

void TaskUpdates;
