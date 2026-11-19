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

import { create, toBinary } from "@bufbuild/protobuf";
import { AnyPacker, TypeUrls } from "@spine-event-engine/core";
import type { ModelCall, ModelPreference } from "@spine-event-engine/proto/agent";
import { VersionSchema } from "@spine-event-engine/proto";
import { expect } from "vitest";
import type { StorageFactory } from "@spine-event-engine/storage";
import {
  AgentAttributes,
  EntityCommitStorageFactories,
  type AgentAttributesRecord,
} from "@spine-event-engine/storage/provider";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
// prettier-ignore
import {
  AgentAttributesRecordSchema,
} from "@spine-event-engine/proto/generated/spine/server/agent/attributes_record_pb.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
  SupportReplyReviewAgentStateSchema,
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

/**
 * Builds complete framework attributes for a genuine support Agent identifier.
 *
 * @param entityId Typed Agent identifier.
 * @param preferences Complete selected models.
 * @param pending Complete pending model calls.
 * @returns Validated detached attributes record.
 */
export function agentAttributes(
  entityId: SupportReplyAgentId,
  preferences: readonly ModelPreference[] = [],
  pending: readonly ModelCall[] = [],
): AgentAttributesRecord {
  return AgentAttributes.record(AgentAttributes.id(entityInput(), entityId), preferences, pending);
}

/**
 * Checks every independent current-state and attributes presence combination.
 *
 * @param factory Live provider factory.
 * @param prefix Unique physical identifier prefix for this test run.
 * @returns Completion after scoped handles close.
 */
export async function checkAgentCurrentMatrix(
  factory: StorageFactory,
  prefix: string,
): Promise<void> {
  const layout = entityInput();
  const commits = EntityCommitStorageFactories.create(factory, layout);
  const current = factory.createRecordStorage(layout.context, layout.recordSpec);
  const id = (suffix: string) =>
    create(SupportReplyAgentIdSchema, { ticketNumber: `${prefix}-${suffix}` });
  const onlyCurrent = id("current");
  const onlyAttributes = id("attributes");
  const both = id("both");
  const absent = id("absent");
  const record = (entityId: SupportReplyAgentId) =>
    create(EntityRecordSchema, {
      entityId: layout.id.pack(entityId),
      state: AnyPacker.pack(
        SupportReplyAgentStateSchema,
        create(SupportReplyAgentStateSchema, { id: entityId }),
      ),
      version: create(VersionSchema, { number: 1 }),
    });
  try {
    expect(await commits.readAgentCurrent(absent)).toEqual({
      current: undefined,
      attributes: undefined,
    });
    const savedCurrent = record(onlyCurrent);
    await current.write(savedCurrent);
    const loadedCurrent = await commits.readAgentCurrent(onlyCurrent);
    expect(loadedCurrent.attributes).toBeUndefined();
    if (loadedCurrent.current === undefined) throw new Error("Current-only Agent state is absent.");
    expect(toBinary(EntityRecordSchema, loadedCurrent.current)).toEqual(
      toBinary(EntityRecordSchema, savedCurrent),
    );
    const savedAttributes = agentAttributes(onlyAttributes);
    await commits.commitAgent({
      entityId: onlyAttributes,
      expectedVersion: 0,
      expectedAttributes: undefined,
      attributes: savedAttributes,
    });
    const loadedAttributes = await commits.readAgentCurrent(onlyAttributes);
    expect(loadedAttributes.current).toBeUndefined();
    if (loadedAttributes.attributes === undefined)
      throw new Error("Attributes-only Agent record is absent.");
    expect(toBinary(AgentAttributesRecordSchema, loadedAttributes.attributes)).toEqual(
      toBinary(AgentAttributesRecordSchema, savedAttributes),
    );
    const next = record(both);
    const nextAttributes = agentAttributes(both);
    await commits.commitAgent({
      entityId: both,
      expectedVersion: 0,
      expectedAttributes: undefined,
      attributes: nextAttributes,
      entityCommit: { context: layout.context, entity: layout, entityId: both, next },
    });
    const loadedBoth = await commits.readAgentCurrent(both);
    if (loadedBoth.current === undefined || loadedBoth.attributes === undefined)
      throw new Error("Complete Agent current data is absent.");
    expect(toBinary(EntityRecordSchema, loadedBoth.current)).toEqual(
      toBinary(EntityRecordSchema, next),
    );
    expect(toBinary(AgentAttributesRecordSchema, loadedBoth.attributes)).toEqual(
      toBinary(AgentAttributesRecordSchema, nextAttributes),
    );
    const reviewLayout = {
      ...layout,
      sourceType: SupportReplyReviewAgentStateSchema,
      stateSchema: SupportReplyReviewAgentStateSchema,
      recordSpec: new RecordSpec<SupportReplyAgentId, EntityRecord>({
        sourceType: SupportReplyReviewAgentStateSchema,
        recordType: EntityRecordSchema,
        idSchema: SupportReplyAgentIdSchema,
        extractId: (value) => {
          if (value.entityId === undefined) throw new TypeError("Review Agent ID is required.");
          return AnyPacker.unpack(value.entityId, SupportReplyAgentIdSchema);
        },
      }),
    };
    const review = EntityCommitStorageFactories.create(factory, reviewLayout);
    try {
      expect(await review.readAgentCurrent(onlyAttributes)).toEqual({
        current: undefined,
        attributes: undefined,
      });
    } finally {
      await review.close();
    }
  } finally {
    current.close();
    await commits.close();
  }
}
