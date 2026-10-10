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

import { clone, create } from "@bufbuild/protobuf";
import {
  AbstractAssignee,
  AbstractEventSubscriber,
  Assign,
  Subscribe,
} from "@spine-event-engine/server";

import type { ReviewSupportReply } from "../../generated/spine/server/testing/support_agent_commands_pb.js";
import {
  SupportReplyUnavailableSchema,
  type SupportReplyUnavailable,
} from "../../generated/spine/server/testing/support_agent_rejections_pb.js";
import {
  SupportReplyReviewStartedSchema as ReviewStartedSchema,
  type SupportReplyReviewStarted,
} from "../../generated/spine/server/testing/support_review_events_pb.js";

/**
 * Records declared support reply rejections through generated Event subscription.
 */
export class SupportRejectionSubscriber extends AbstractEventSubscriber {
  /**
   * Rejection messages received by this instance.
   */
  readonly rejections: SupportReplyUnavailable[] = [];
  // prettier-ignore

  /**
   * Records one delivered support rejection.
   * @param rejection Rejected ticket identity.
   */
  @Subscribe onReplyUnavailable(rejection: SupportReplyUnavailable): void {
    this.rejections.push(clone(SupportReplyUnavailableSchema, rejection));
  }
}

/**
 * Accepts review Commands through generated standalone assignment.
 */
export class SupportReviewAssignee extends AbstractAssignee {
  /**
   * Review Commands received by this instance.
   */
  readonly requests: ReviewSupportReply[] = [];
  // prettier-ignore

  /**
   * Records the review request and emits its typed domain Event.
   * @param command Ticket awaiting human review.
   * @returns Review-started Event for this ticket.
   */
  @Assign startReview(command: ReviewSupportReply): SupportReplyReviewStarted {
    this.requests.push(command);
    return create(ReviewStartedSchema, { agent: command.agent });
  }
}
