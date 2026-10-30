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
import type { Any } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { AnyPacker, ValidationException } from "@spine-event-engine/core";
import { ErrorSchema, ValidationErrorSchema } from "@spine-event-engine/proto";
import {
  QueryValidationError,
  SubscriptionValidationError,
  type Subscription,
  TopicValidationError,
} from "@spine-event-engine/proto/client";

/**
 * Public read-side requests with distinct Spine validation enums.
 */
export type ReadRequestKind = "query" | "topic" | "subscription";

/**
 * Maps read-side validation to native Spine Error trailers and Connect details.
 */
export const ReadRequestStatus = {
  /**
   * Validates a complete request and sanitizes unexpected validator failures.
   *
   * @param kind The public request kind.
   * @param validate Performs declared Protobuf validation.
   */
  check(kind: ReadRequestKind, validate: () => unknown): void {
    try {
      validate();
    } catch (error) {
      if (error instanceof ValidationException) {
        throw ReadRequestStatus.invalid(
          kind,
          false,
          `${kind} validation failed.`,
          AnyPacker.pack(ValidationErrorSchema, error.asMessage()),
        );
      }
      throw new ConnectError("Read request validation failed.", Code.Internal);
    }
  },

  /**
   * Rejects unusable Topic criteria in lifecycle requests before record access.
   *
   * @param subscription Validated activation or cancellation request.
   */
  checkLifecycleCriterion(subscription: Subscription): void {
    const criterion = subscription.topic?.target?.criterion;
    if (criterion?.case === "includeAll" && criterion.value) return;
    if (criterion?.case === "filters") {
      const filters = criterion.value;
      if ((filters.idFilter?.id.length ?? 0) > 0 || filters.filter.length > 0) return;
      throw ReadRequestStatus.invalid(
        "subscription",
        false,
        "Subscription requires an ID filter or field filter.",
      );
    }
    throw ReadRequestStatus.invalid(
      "subscription",
      false,
      "Subscription requires filters or include_all = true.",
    );
  },

  /**
   * Maps tenant admission to a distinct structured status.
   *
   * @param type Existing tenant failure type.
   * @param message Safe tenant explanation.
   * @returns A structured InvalidArgument status.
   */
  tenant(type: string, message: string): ConnectError {
    const value = create(ErrorSchema, { type, code: Code.InvalidArgument, message });
    const metadata = new Headers({
      "spine-error-bin": Buffer.from(toBinary(ErrorSchema, value)).toString("base64"),
    });
    return new ConnectError(message, Code.InvalidArgument, metadata, [
      { desc: ErrorSchema, value },
    ]);
  },

  /**
   * Creates an InvalidArgument status with an enum-qualified Spine Error.
   *
   * @param kind The invalid read-side request.
   * @param unsupported Whether its target is not registered.
   * @param message Safe public explanation.
   * @param details Declared constraint violations, when available.
   * @returns A transport error carrying native and Connect structured details.
   */
  invalid(
    kind: ReadRequestKind,
    unsupported: boolean,
    message: string,
    details?: Any,
  ): ConnectError {
    const type = `spine.client.${kind.charAt(0).toUpperCase()}${kind.slice(1)}ValidationError`;
    const code = unsupported
      ? kind === "query"
        ? QueryValidationError.UNSUPPORTED_QUERY_TARGET
        : TopicValidationError.UNSUPPORTED_TOPIC_TARGET
      : kind === "query"
        ? QueryValidationError.INVALID_QUERY
        : kind === "topic"
          ? TopicValidationError.INVALID_TOPIC
          : SubscriptionValidationError.INVALID_SUBSCRIPTION;
    const value = create(ErrorSchema, { type, code, message, details });
    const metadata = new Headers({
      "spine-error-bin": Buffer.from(toBinary(ErrorSchema, value)).toString("base64"),
    });
    return new ConnectError(message, Code.InvalidArgument, metadata, [
      { desc: ErrorSchema, value },
    ]);
  },
};
