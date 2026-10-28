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

import type { Any } from "@bufbuild/protobuf/wkt";
import type { Command, Event } from "@spine-event-engine/proto";
import type {
  AiConnectionIdentity,
  AiOperationId,
  ConversationId,
  ModelRef,
} from "@spine-event-engine/proto/agent";
import { AiModelKind } from "@spine-event-engine/proto/agent";

/**
 * One original accepted source envelope, without durable execution metadata.
 */
export type AgentSource =
  | {
      /**
       * Identifies an original Command source.
       */
      readonly case: "command";

      /**
       * Original Command envelope.
       */
      readonly value: Command;
    }
  | {
      /**
       * Identifies an original Event source.
       */
      readonly case: "event";

      /**
       * Original Event envelope.
       */
      readonly value: Event;
    };

/**
 * Typed original facts carried only by one live Agent invocation.
 */
export interface AgentLiveInvocation {
  /**
   * Original accepted Command or Event.
   */
  readonly source: AgentSource;

  /**
   * Exact typed recipient identifier.
   */
  readonly recipientId: Any;

  /**
   * Declared Agent state type URL.
   */
  readonly stateType: string;
}

/**
 * Selected deployment and validated connection for one live model kind.
 */
export interface AgentLiveModel {
  /**
   * Selected live capability kind.
   */
  readonly kind: AiModelKind.GENERATION | AiModelKind.DECISION;

  /**
   * Selected model reference.
   */
  readonly model: ModelRef;

  /**
   * Authenticated connection selected for this model.
   */
  readonly connection: AiConnectionIdentity;
}

/**
 * Required correlation fields for one handler's named AI operation.
 */
export interface AgentOperationIdentity {
  /**
   * Identifier of the current named AI operation.
   */
  readonly operation: AiOperationId;

  /**
   * Conversation correlated with the operation.
   */
  readonly conversation: ConversationId;
}
