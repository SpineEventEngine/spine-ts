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

import { create, type Message } from "@bufbuild/protobuf";
import { base64Encode } from "@bufbuild/protobuf/wire";
import { TypeUrls, Validate } from "@spine-event-engine/core";
import { AgentIdSchema, type AgentId } from "@spine-event-engine/proto/agent";

import type { EntityStorageInput } from "./entity-history.js";

/**
 * Complete Agent identity operations shared by active state and history.
 */
interface AgentIdentityAccess {
  /**
   * Creates a detached typed identity from one Entity layout and identifier.
   * @typeParam I Typed Agent identifier.
   * @typeParam S Agent state message.
   * @param entity Bound Entity layout.
   * @param entityId Typed Agent identifier.
   * @returns Complete Agent identity.
   */
  id<I, S extends Message>(entity: EntityStorageInput<I, S>, entityId: I): AgentId;

  /**
   * Encodes complete typed identity as stable versioned text.
   * @param agent Complete Agent identity.
   * @returns Stable versioned tuple text.
   */
  text(agent: AgentId): string;
}

/**
 * Constructs and compares the complete typed identity used by active state and history.
 */
export const AgentIdentity: AgentIdentityAccess = Object.freeze({
  /**
   * Captures the generated state type and packed typed identifier.
   * @typeParam I Typed Agent identifier.
   * @typeParam S Agent state message.
   * @param entity Bound Entity layout.
   * @param entityId Typed Agent identifier.
   * @returns Detached complete Agent identity.
   */
  id<I, S extends Message>(entity: EntityStorageInput<I, S>, entityId: I): AgentId {
    return create(AgentIdSchema, {
      stateTypeUrl: TypeUrls.derive(entity.stateSchema),
      entityId: entity.id.pack(entity.id.clone(entityId)),
    });
  },

  /**
   * Encodes the complete typed identity without relying on a provider digest.
   * @param agent Complete Agent identity.
   * @returns Stable versioned tuple text.
   */
  text(agent: AgentId): string {
    Validate.check(AgentIdSchema, agent);
    if (!agent.stateTypeUrl || !agent.entityId?.typeUrl)
      throw new TypeError("Agent requires complete typed identity.");
    return JSON.stringify([
      "spine.agent.AgentId/v1",
      agent.stateTypeUrl,
      agent.entityId.typeUrl,
      base64Encode(agent.entityId.value, "std"),
    ]);
  },
});
