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
import { Validate } from "@spine-event-engine/core";
import {
  AiModelKind,
  ModelPreferenceSchema,
  type ModelPreference,
} from "@spine-event-engine/proto/agent";
import {
  AgentModelPreferencesKeySchema as PreferencesKeySchema,
  AgentModelPreferencesRecordSchema as PreferencesRecordSchema,
  type AgentModelPreferencesKey as PreferencesKey,
  type AgentModelPreferencesRecord,
} from "@spine-event-engine/proto/generated/spine/server/agent/model_preferences_record_pb.js";

import type { EntityStorageInput } from "./entity-history.js";
import { RecordSpec } from "../record/record-spec.js";
import { StorageGroup } from "../record/storage-group.js";

/**
 * Complete identity and immutable preference image operations for providers.
 */
interface AgentModelPreferencesAccess {
  readonly group: StorageGroup;

  /**
   * Creates the physical preference record definition.
   *
   * @param digest Provider SHA-256 encoder.
   * @returns The record definition.
   */
  spec(digest: (value: string) => string): RecordSpec<string, PreferencesRecord>;

  /**
   * Captures the complete typed Agent identity.
   *
   * @param entity Bound Entity layout.
   * @param entityId Typed Agent identifier.
   * @returns The detached preference key.
   * @typeParam I Typed Agent identifier.
   * @typeParam S Generated Agent state.
   */
  key<I, S extends Message>(entity: EntityStorageInput<I, S>, entityId: I): PreferencesKey;

  /**
   * Encodes the exact typed identity tuple.
   *
   * @param key Complete preference key.
   * @returns Stable tuple text for a bounded slot.
   */
  text(key: PreferencesKey): string;

  /**
   * Copies and validates the complete preference image.
   *
   * @param preferences Complete model selections.
   * @returns Detached validated selections.
   */
  copy(preferences: readonly ModelPreference[]): readonly ModelPreference[];

  /**
   * Compares complete preference images, including absence.
   *
   * @param left First image.
   * @param right Second image.
   * @returns Whether the images match exactly.
   */
  same(
    left: readonly ModelPreference[] | undefined,
    right: readonly ModelPreference[] | undefined,
  ): boolean;

  /**
   * Creates an inert record with complete identity evidence.
   *
   * @param key Complete typed Agent key.
   * @param preferences Complete replacement selections.
   * @returns Detached preference record.
   */
  record(key: PreferencesKey, preferences: readonly ModelPreference[]): PreferencesRecord;

  /**
   * Verifies the body identity against its bounded physical slot.
   *
   * @param record Persisted preference record.
   * @param key Expected complete identity.
   */
  requireIdentity(record: PreferencesRecord, key: PreferencesKey): void;
}

/**
 * Captures and compares complete current model selections without executable state.
 */
const operations: AgentModelPreferencesAccess = Object.freeze({
  group: new StorageGroup("spine_agent_model_preferences"),

  /**
   * Creates one bounded physical preference family.
   * @param digest Provider SHA-256 hex encoder.
   * @returns Generated record layout with complete evidence in each body.
   */
  spec(digest: (value: string) => string): RecordSpec<string, PreferencesRecord> {
    return new RecordSpec<string, PreferencesRecord>({
      idKind: "string",
      recordType: PreferencesRecordSchema,
      extractId: (record) => {
        if (record.key === undefined)
          throw new TypeError("Agent model preference record requires identity.");
        return `v1:${digest(this.text(record.key))}`;
      },
    });
  },

  /**
   * Captures one typed Agent identity before provider I/O.
   * @param entity Bound Entity layout and ID codec.
   * @param entityId Typed Agent identifier.
   * @returns Complete generated preference identity.
   * @typeParam I Typed identifier.
   * @typeParam S Generated Agent state.
   */
  key<I, S extends Message>(entity: EntityStorageInput<I, S>, entityId: I): PreferencesKey {
    return create(PreferencesKeySchema, {
      stateType: entity.stateSchema.typeName,
      recipientId: entity.id.pack(entity.id.clone(entityId)),
    });
  },

  /**
   * Encodes exact typed identity fields for a bounded provider slot.
   * @param key Complete generated identity.
   * @returns Stable versioned tuple text.
   */
  text(key: PreferencesKey): string {
    if (!key.stateType || !key.recipientId?.typeUrl)
      throw new TypeError("Agent model preferences require complete typed identity.");
    return JSON.stringify([
      "spine.server.agent.AgentModelPreferencesKey/v1",
      key.stateType,
      key.recipientId.typeUrl,
      base64Encode(key.recipientId.value, "std"),
    ]);
  },

  /**
   * Copies and validates a complete preference array.
   * @param preferences Current selections.
   * @returns Detached validated selections.
   */
  copy(preferences: readonly ModelPreference[]): readonly ModelPreference[] {
    const seen = new Set<AiModelKind>();
    return preferences.map((preference) => {
      Validate.check(ModelPreferenceSchema, preference);
      if (
        (preference.kind !== AiModelKind.GENERATION && preference.kind !== AiModelKind.DECISION) ||
        seen.has(preference.kind)
      )
        throw new TypeError("Agent model preferences require unique supported kinds.");
      seen.add(preference.kind);
      return clone(ModelPreferenceSchema, preference);
    });
  },

  /**
   * Compares complete ordered preference images including unknown fields.
   * @param left First observed image.
   * @param right Second observed image.
   * @returns Whether both images encode identically.
   */
  same(
    left: readonly ModelPreference[] | undefined,
    right: readonly ModelPreference[] | undefined,
  ): boolean {
    if (left === undefined || right === undefined) return left === right;
    if (left.length !== right.length) return false;
    return left.every((item, index) => {
      const prior = right[index];
      if (prior === undefined) return false;
      const a = toBinary(ModelPreferenceSchema, item);
      const b = toBinary(ModelPreferenceSchema, prior);
      return a.length === b.length && a.every((byte, at) => byte === b[at]);
    });
  },

  /**
   * Builds an inert preference record from complete evidence.
   * @param key Typed Agent identity.
   * @param preferences Complete next selections.
   * @returns Detached record.
   */
  record(key: PreferencesKey, preferences: readonly ModelPreference[]): PreferencesRecord {
    return create(PreferencesRecordSchema, {
      key: clone(PreferencesKeySchema, key),
      preferences: [...this.copy(preferences)],
    });
  },

  /**
   * Verifies that a slot still contains the expected complete identity.
   * @param record Stored preference evidence.
   * @param key Expected typed Agent identity.
   */
  requireIdentity(record: PreferencesRecord, key: PreferencesKey): void {
    if (record.key === undefined || this.text(record.key) !== this.text(key))
      throw new Error("Agent model preference identity conflict.");
  },
});

/**
 * Provider-only complete Agent preference identity and image operations.
 */
export const AgentModelPreferences: AgentModelPreferencesAccess = operations;

/**
 * Describes stored complete preference identity and image.
 */
export type PreferencesRecord = AgentModelPreferencesRecord;
