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

import type { CommandAcknowledgement } from "@spine-event-engine/client-web";
import { AnyPacker } from "@spine-event-engine/core";
import { ErrorSchema, ValidationErrorSchema } from "@spine-event-engine/proto";

/**
 * Describes validation messages returned for the MessageBoard form.
 */
export interface PostFeedbackValue {
  // prettier-ignore

  /**
   * Maps each invalid form field to the server-provided message.
   */
  readonly fields: Readonly<Partial<Record<"username" | "text", string>>>;

  /**
   * Explains a failure that is not tied to one form field.
   */
  readonly general?: string;
}

/**
 * Converts a refused Command acknowledgement into messages suitable for the post form.
 */
export const PostFeedback: Readonly<{
  // prettier-ignore

  from(acknowledgement: Exclude<CommandAcknowledgement, { readonly kind: "ok" }>): PostFeedbackValue;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Extracts field messages from packed server validation details.
   *
   * @param acknowledgement The refusal returned during Command admission.
   * @returns The field messages or a general retry notice.
   */
  from(acknowledgement: Exclude<CommandAcknowledgement, { readonly kind: "ok" }>): PostFeedbackValue {
    const general: PostFeedbackValue = {
      fields: {},
      general: "Message was not posted. Please retry.",
    };
    if (acknowledgement.kind !== "error" || acknowledgement.error.$typeName !== ErrorSchema.typeName)
      return general;
    const details = (
      acknowledgement.error as { readonly details?: Parameters<typeof AnyPacker.unpack>[0] }
    ).details;
    const validation =
      details === undefined ? undefined : AnyPacker.tryUnpack(details, ValidationErrorSchema);
    if (validation === undefined) return general;
    const fields: Partial<Record<"username" | "text", string>> = {};
    for (const violation of validation.constraintViolation) {
      const field = violation.fieldPath?.fieldName.at(-1);
      if (field !== "username" && field !== "text") continue;
      const template = violation.message;
      if (template === undefined || template.withPlaceholders.length === 0) continue;
      fields[field] = template.withPlaceholders.replace(
        /\$\{([^}]+)\}/gu,
        (match, name: string) => template.placeholderValue[name] ?? match,
      );
    }
    return Object.keys(fields).length === 0 ? general : { fields };
  },
});
