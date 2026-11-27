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
import { AnyPacker, Identifiers, SignalEnvelopes, TypeUrls } from "@spine-event-engine/core";
import { Time } from "@spine-event-engine/core/time";
import { CommandContextSchema, CommandSchema } from "@spine-event-engine/proto";
import type { ShardIndex } from "@spine-event-engine/server";
import type { InboxMessageInput } from "@spine-event-engine/server/spi/delivery";
import { CreateProjectSchema } from "@spine-event-engine/server-test-fixtures/entity/project_commands_pb.js";
import { ProjectStateSchema } from "@spine-event-engine/server-test-fixtures/entity/project_states_pb.js";

/**
 * Creates a pending Command for the Project handler in this fixture.
 *
 * @param projectId Identifies the project to create.
 * @param shard Selects the delivery shard.
 * @returns The pending Command and its recipient.
 */
export function projectInboxInput(projectId: string, shard: ShardIndex): InboxMessageInput {
  const signal = SignalEnvelopes.command({
    schema: CreateProjectSchema,
    message: create(CreateProjectSchema, { id: projectId, name: projectId }),
    context: create(CommandContextSchema),
  });
  if (signal.id === undefined) throw new Error("Expected a Command ID.");
  return {
    inboxId: {
      targetId: Identifiers.pack("string", projectId),
      targetTypeUrl: TypeUrls.derive(ProjectStateSchema),
    },
    signalId: signal.id.uuid,
    signal: AnyPacker.pack(CommandSchema, signal),
    label: "HANDLE_COMMAND",
    status: "TO_DELIVER",
    shard,
    whenReceived: Time.currentTime(),
    version: 1n,
  };
}
