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

import { AbstractEventSubscriber, Projection, Subscribe } from "@spine-event-engine/server";

import type { SupportReplyAgentId } from "../../generated/spine/server/testing/support_agent_states_pb.js";
import type { SupportReplyDrafted } from "../../generated/spine/server/testing/support_agent_events_pb.js";
// prettier-ignore
import {
  SupportDraftProjectionStateSchema as DraftStateSchema,
} from "../../generated/spine/server/testing/support_recovery_states_pb.js";

/**
 * Persists the accepted support draft for a reviewer after Event fan-out.
 */
export class SupportDraftProjection extends Projection<
  SupportReplyAgentId,
  typeof DraftStateSchema
> {
  // prettier-ignore

  /**
   * Records the original draft against its ticket identity.
   * @param event Accepted support draft.
   */
  @Subscribe onDraft(event: SupportReplyDrafted): void {
    this.update((state) => {
      state.id = event.agent;
      state.proposedReply = event.reply;
    });
  }
}

/**
 * Reports receipt before another generated recipient is interrupted.
 */
export class SupportDraftReceiptObserver extends AbstractEventSubscriber {
  readonly #onReceive: (event: SupportReplyDrafted) => Promise<void>;

  /**
   * Creates a recipient that reports the accepted draft.
   * @param onReceive Reports the accepted draft to the process harness.
   */
  constructor(onReceive: (event: SupportReplyDrafted) => Promise<void> = () => Promise.resolve()) {
    super();
    this.#onReceive = onReceive;
  }

  // prettier-ignore

  /**
   * Calls the receipt callback before later recipient delivery.
   * @param event Accepted support draft.
   * @returns Completion after the callback reports receipt.
   */
  @Subscribe async onDraft(event: SupportReplyDrafted): Promise<void> {
    await this.#onReceive(event);
  }
}

/**
 * Receives the same draft through a separate generated standalone dispatcher.
 */
export class SupportDraftObserver extends AbstractEventSubscriber {
  readonly #onReceive: (event: SupportReplyDrafted) => Promise<void>;

  /**
   * Creates a recipient that can hold later delivery.
   * @param onReceive Callback that can hold the second recipient before acknowledgement.
   */
  constructor(onReceive: (event: SupportReplyDrafted) => Promise<void> = () => Promise.resolve()) {
    super();
    this.#onReceive = onReceive;
  }

  // prettier-ignore

  /**
   * Calls the separate recipient with the accepted draft.
   * @param event Accepted support draft.
   * @returns Completion after the recipient finishes.
   */
  @Subscribe async onDraft(event: SupportReplyDrafted): Promise<void> {
    await this.#onReceive(event);
  }
}
