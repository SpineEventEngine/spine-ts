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
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
  type SupportReplyAgentId,
  type SupportReplyAgentState,
} from "../../../server/test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import type { EntityStorageInput } from "../../src/internal/entity-history.js";
import { RecordSpec } from "../../src/record/record-spec.js";

const idTypeUrl = TypeUrls.derive(SupportReplyAgentIdSchema);

/**
 * Builds a typed support Agent repository layout for provider execution checks.
 * @returns Complete Entity storage input.
 */
export function entityInput(): EntityStorageInput<SupportReplyAgentId, SupportReplyAgentState> {
  return {
    context: { name: "Support", multitenant: false },
    id: {
      clone: (id) => create(SupportReplyAgentIdSchema, { ticketNumber: id.ticketNumber }),
      key: (id) => id.ticketNumber,
      pack: (id) => AnyPacker.pack(SupportReplyAgentIdSchema, id),
      unpack: (value) => AnyPacker.tryUnpack(value, SupportReplyAgentIdSchema),
    },
    columns: [],
    recordSpec: new RecordSpec<SupportReplyAgentId, EntityRecord>({
      sourceType: SupportReplyAgentStateSchema,
      recordType: EntityRecordSchema,
      idSchema: SupportReplyAgentIdSchema,
      extractId: (record) => {
        if (record.entityId?.typeUrl !== idTypeUrl)
          throw new TypeError("Support Agent current record requires its typed ID.");
        return AnyPacker.unpack(record.entityId, SupportReplyAgentIdSchema);
      },
    }),
    sourceType: SupportReplyAgentStateSchema,
    stateSchema: SupportReplyAgentStateSchema,
  };
}
