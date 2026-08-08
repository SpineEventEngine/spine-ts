import { create, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
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
        new RecordColumn("entity_id", (record) => record.entityId, "message"),
        new RecordColumn(
          "created",
          (record) => record.version?.timestamp ?? create(TimestampSchema),
          "timestamp",
        ),
        new RecordColumn("version", (record) => record.version?.number ?? 0, "int32"),
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
        new RecordColumn("entity_id", (event) => event.context?.producerId, "message"),
        new RecordColumn(
          "created",
          (event) => event.context?.timestamp ?? create(TimestampSchema),
          "timestamp",
        ),
        new RecordColumn("version", (event) => event.context?.version?.number ?? 0, "int32"),
      ],
    }),
  };
}
