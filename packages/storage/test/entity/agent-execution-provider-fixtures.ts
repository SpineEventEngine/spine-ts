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
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { RecordSpec } from "@spine-event-engine/storage";
import type { EntityStorageInput } from "@spine-event-engine/storage/provider";
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

const idTypeUrl = `type.spine.server.testing/${SupportReplyAgentIdSchema.typeName}`;

/**
 * Builds the typed support Agent layout using published provider classes.
 */
export function providerEntityInput(): EntityStorageInput<
  SupportReplyAgentId,
  SupportReplyAgentState
> {
  return {
    context: { name: "Support", multitenant: false },
    id: {
      clone: (id) => create(SupportReplyAgentIdSchema, { ticketNumber: id.ticketNumber }),
      key: (id) => id.ticketNumber,
      pack: (id) =>
        create(AnySchema, { typeUrl: idTypeUrl, value: toBinary(SupportReplyAgentIdSchema, id) }),
      unpack: (value) =>
        value.typeUrl === idTypeUrl
          ? fromBinary(SupportReplyAgentIdSchema, value.value)
          : undefined,
    },
    columns: [],
    recordSpec: new RecordSpec<SupportReplyAgentId, EntityRecord>({
      sourceType: SupportReplyAgentStateSchema,
      recordType: EntityRecordSchema,
      idSchema: SupportReplyAgentIdSchema,
      extractId: (record) => {
        if (record.entityId?.typeUrl !== idTypeUrl)
          throw new TypeError("Support Agent current record requires its typed ID.");
        return fromBinary(SupportReplyAgentIdSchema, record.entityId.value);
      },
    }),
    sourceType: SupportReplyAgentStateSchema,
    stateSchema: SupportReplyAgentStateSchema,
  };
}
