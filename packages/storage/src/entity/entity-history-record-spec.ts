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
import { create, ScalarType, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { AnySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { EventIdSchema, EventSchema, type Event, type EventId } from "@spine-event-engine/proto";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import {
  EntityStateKeySchema,
  type EntityStateKey,
} from "@spine-event-engine/proto/generated/spine/server/entity/state_key_pb.js";

import { RecordColumn } from "../record/record-column.js";
import { ColumnTypes } from "../record/column-type.js";
import { RecordSpec } from "../record/record-spec.js";
import { StorageGroup } from "../record/storage-group.js";

/**
 * Creates the generated state-history layout for one Entity state type.
 * @param stateType The served Entity state message type.
 * @returns The separate group and record specification for retained states.
 */
export function stateHistorySpec(stateType: GenMessage<Message>): {
  readonly group: StorageGroup;
  readonly spec: RecordSpec<EntityStateKey, EntityRecord>;
} {
  return {
    group: new StorageGroup(stateType.typeName),
    spec: new RecordSpec({
      sourceType: stateType,
      recordType: EntityRecordSchema,
      idSchema: EntityStateKeySchema,
      extractId: (record) => {
        if (record.entityId === undefined) {
          throw new Error("State history requires EntityRecord.entityId.");
        }
        return create(EntityStateKeySchema, {
          entityId: record.entityId,
          version: record.version?.number ?? 0,
        });
      },
      columns: [
        new RecordColumn("entity_id", ColumnTypes.message(AnySchema), (record) => record.entityId),
        new RecordColumn(
          "created",
          ColumnTypes.message(TimestampSchema),
          (record) => record.version?.timestamp ?? create(TimestampSchema),
        ),
        new RecordColumn(
          "version",
          ColumnTypes.scalar(ScalarType.INT32),
          (record) => record.version?.number ?? 0,
        ),
      ],
    }),
  };
}

/**
 * Creates the generated diagnostic event-history layout for one Entity state type.
 * @param stateType The served Entity state message type.
 * @returns The separate group and record specification for retained events.
 */
export function eventHistorySpec(stateType: GenMessage<Message>): {
  readonly group: StorageGroup;
  readonly spec: RecordSpec<EventId, Event>;
} {
  return {
    group: new StorageGroup(stateType.typeName),
    spec: new RecordSpec({
      sourceType: EventSchema,
      recordType: EventSchema,
      idSchema: EventIdSchema,
      extractId: (event) => {
        if (event.id === undefined) throw new Error("Event history requires Event.id.");
        return event.id;
      },
      columns: [
        new RecordColumn(
          "entity_id",
          ColumnTypes.message(AnySchema),
          (event) => event.context?.producerId,
        ),
        new RecordColumn(
          "created",
          ColumnTypes.message(TimestampSchema),
          (event) => event.context?.timestamp ?? create(TimestampSchema),
        ),
        new RecordColumn(
          "version",
          ColumnTypes.scalar(ScalarType.INT32),
          (event) => event.context?.version?.number ?? 0,
        ),
      ],
    }),
  };
}
