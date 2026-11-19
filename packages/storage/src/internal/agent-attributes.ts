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

import { clone, create, toBinary, type Message } from "@bufbuild/protobuf";
import { base64Encode } from "@bufbuild/protobuf/wire";
import { TypeUrls, Validate } from "@spine-event-engine/core";
import {
  AgentIdSchema,
  AiModelKind,
  ModelPreferenceSchema,
  type AgentId,
  type ModelCall,
  type ModelPreference,
} from "@spine-event-engine/proto/agent";
import {
  AgentAttributesRecordSchema,
  type AgentAttributesRecord as ProtoAgentAttributesRecord,
} from "@spine-event-engine/proto/generated/spine/server/agent/attributes_record_pb.js";

import type { EntityStorageInput } from "./entity-history.js";
import { RecordSpec } from "../record/record-spec.js";
import { StorageGroup } from "../record/storage-group.js";

/**
 * Complete provider image of one Agent's framework attributes.
 */
export type AgentAttributesRecord = ProtoAgentAttributesRecord;

/**
 * Complete Agent attributes and typed identity operations for providers.
 */
interface AgentAttributesAccess {
  readonly group: StorageGroup;

  /**
   * Creates the physical attributes record definition.
   * @param digest Provider SHA-256 encoder.
   * @returns The record definition.
   */
  spec(digest: (value: string) => string): RecordSpec<string, AgentAttributesRecord>;

  /**
   * Captures the complete typed Agent identity.
   * @typeParam I Typed Agent identifier.
   * @typeParam S Agent state message.
   * @param entity Bound Entity layout.
   * @param entityId Typed Agent identifier.
   * @returns Detached Agent identity.
   */
  id<I, S extends Message>(entity: EntityStorageInput<I, S>, entityId: I): AgentId;

  /**
   * Encodes the exact typed identity tuple.
   * @param agent Complete Agent identity.
   * @returns Stable tuple text for a bounded slot.
   */
  text(agent: AgentId): string;

  /**
   * Validates and detaches a complete attributes image.
   * @param record Complete stored or prepared image.
   * @returns Independent validated attributes.
   */
  copy(record: AgentAttributesRecord): AgentAttributesRecord;

  /**
   * Compares complete attributes images, including absence and unknown fields.
   * @param left First image.
   * @param right Second image.
   * @returns Whether the images encode identically.
   */
  same(left: AgentAttributesRecord | undefined, right: AgentAttributesRecord | undefined): boolean;

  /**
   * Creates a complete attributes image.
   * @param agent Complete typed Agent identity.
   * @param preferences Complete model selections.
   * @param pending Complete pending model calls.
   * @returns Detached attributes record.
   */
  record(
    agent: AgentId,
    preferences: readonly ModelPreference[],
    pending: readonly ModelCall[],
  ): AgentAttributesRecord;

  /**
   * Verifies the body identity against its bounded physical slot.
   * @param record Persisted attributes record.
   * @param agent Expected complete identity.
   */
  requireIdentity(record: AgentAttributesRecord, agent: AgentId): void;
}

/**
 * Captures and compares complete framework-maintained Agent attributes.
 */
export const AgentAttributes: AgentAttributesAccess = Object.freeze({
  group: new StorageGroup("spine_agent_attributes"),

  /**
   * Creates one bounded physical attributes family.
   * @param digest Provider SHA-256 hex encoder.
   * @returns Generated record layout with complete identity evidence.
   */
  spec(digest: (value: string) => string): RecordSpec<string, AgentAttributesRecord> {
    return new RecordSpec<string, AgentAttributesRecord>({
      idKind: "string",
      recordType: AgentAttributesRecordSchema,
      extractId: (record) => {
        if (record.agent === undefined) throw new TypeError("Agent attributes require identity.");
        return "v1:" + digest(this.text(record.agent));
      },
    });
  },

  /**
   * Captures the exact state type URL and packed typed Agent identifier.
   * @typeParam I Typed Agent identifier.
   * @typeParam S Agent state message.
   * @param entity Bound Entity layout and ID codec.
   * @param entityId Typed Agent identifier.
   * @returns Complete generated Agent identity.
   */
  id<I, S extends Message>(entity: EntityStorageInput<I, S>, entityId: I): AgentId {
    return create(AgentIdSchema, {
      stateTypeUrl: TypeUrls.derive(entity.stateSchema),
      entityId: entity.id.pack(entity.id.clone(entityId)),
    });
  },

  /**
   * Encodes exact typed identity fields for a bounded provider slot.
   * @param agent Complete Agent identity.
   * @returns Stable versioned tuple text.
   */
  text(agent: AgentId): string {
    if (!agent.stateTypeUrl || !agent.entityId?.typeUrl)
      throw new TypeError("Agent attributes require complete typed identity.");
    return JSON.stringify([
      "spine.agent.AgentId/v1",
      agent.stateTypeUrl,
      agent.entityId.typeUrl,
      base64Encode(agent.entityId.value, "std"),
    ]);
  },

  /**
   * Checks complete attributes, duplicate selections, and duplicate pending calls.
   * @param record Current or proposed attributes.
   * @returns Independent validated image.
   */
  copy(record: AgentAttributesRecord): AgentAttributesRecord {
    Validate.check(AgentAttributesRecordSchema, record);
    const agent = record.agent;
    if (agent === undefined) throw new TypeError("Agent attributes require identity.");
    const seenKinds = new Set<AiModelKind>();
    for (const preference of record.modelPreferences) {
      Validate.check(ModelPreferenceSchema, preference);
      if (
        (preference.kind !== AiModelKind.GENERATION && preference.kind !== AiModelKind.DECISION) ||
        seenKinds.has(preference.kind)
      )
        throw new TypeError("Agent model preferences require unique supported kinds.");
      seenKinds.add(preference.kind);
    }
    const seenCalls = new Set<string>();
    for (const call of record.pendingModelCalls) {
      const id = call.id?.value;
      if (!id || seenCalls.has(id))
        throw new TypeError("Agent pending model call ID must be unique.");
      if (call.agent === undefined || this.text(call.agent) !== this.text(agent))
        throw new TypeError("Agent pending model call has a different Agent identity.");
      seenCalls.add(id);
    }
    return clone(AgentAttributesRecordSchema, record);
  },

  /**
   * Compares complete binary images so unknown fields participate in conflicts.
   * @param left First image.
   * @param right Second image.
   * @returns Whether both images are equal, including absence.
   */
  same(left: AgentAttributesRecord | undefined, right: AgentAttributesRecord | undefined): boolean {
    if (left === undefined || right === undefined) return left === right;
    const a = toBinary(AgentAttributesRecordSchema, left);
    const b = toBinary(AgentAttributesRecordSchema, right);
    return a.length === b.length && a.every((byte, index) => byte === b[index]);
  },

  /**
   * Creates a validated complete attributes image.
   * @param agent Typed Agent identity.
   * @param preferences Complete next model selections.
   * @param pending Complete next pending calls.
   * @returns Detached record.
   */
  record(
    agent: AgentId,
    preferences: readonly ModelPreference[],
    pending: readonly ModelCall[],
  ): AgentAttributesRecord {
    return this.copy(
      create(AgentAttributesRecordSchema, {
        agent: clone(AgentIdSchema, agent),
        modelPreferences: [...preferences],
        pendingModelCalls: [...pending],
      }),
    );
  },

  /**
   * Verifies a stored record's complete typed identity.
   * @param record Stored attributes.
   * @param agent Expected Agent identity.
   */
  requireIdentity(record: AgentAttributesRecord, agent: AgentId): void {
    if (record.agent === undefined || this.text(record.agent) !== this.text(agent))
      throw new Error("Agent attributes identity conflict.");
  },
});
