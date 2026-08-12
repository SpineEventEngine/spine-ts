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
import { type Message } from "@bufbuild/protobuf";
import type { EntityRecord } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { ColumnTypes, RecordColumn, type RecordSpec } from "@spine-event-engine/storage";

import {
  describeEntityMetadata,
  entitySchemaOf,
  type EntityConstructor,
} from "./entity-metadata.js";
import { entityRecordSpec } from "./entity-storage-descriptor.js";
import type { PrimitiveId } from "../repository/primitive-id.js";

interface EntitySpecScanner {
  scan(entityType: EntityConstructor): RecordSpec<Message | PrimitiveId, EntityRecord>;
}

/**
 * Derives the storage record specification carried by one Entity class.
 */
export const SpecScanner: EntitySpecScanner = Object.freeze({
  // prettier-ignore

  /**
   * Reads immutable generated schema metadata from an Entity class.
   *
   * @param entityType Entity class whose generated state schema is scanned.
   * @returns The JVM EntityRecord storage specification for that entity state.
   */
  scan(entityType: EntityConstructor): RecordSpec<Message | PrimitiveId, EntityRecord> {
    const schema = entitySchemaOf(entityType);
    if (schema === undefined) {
      throw new Error("Entity class has no generated state schema metadata.");
    }
    return entityRecordSpec(
      schema,
      describeEntityMetadata(schema).columns.map(
        (field) =>
          new RecordColumn<Message>(
            field.name,
            ColumnTypes.fromField(field.descriptor),
            (state) => (state as Record<string, unknown>)[field.localName],
          ),
      ),
    );
  },
});
