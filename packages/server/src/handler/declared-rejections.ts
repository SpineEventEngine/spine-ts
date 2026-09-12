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

import { type RejectionThrowable } from "@spine-event-engine/core";

import { type DescriptorMessageSchema } from "../entity/entity-metadata.js";

interface DeclaredRejectionChecks {
  require(
    methodName: string,
    schemas: readonly DescriptorMessageSchema[],
    rejection: RejectionThrowable,
  ): void;
}

/** Checks actual domain rejections against generated handler declarations. */
export const DeclaredRejections: Readonly<DeclaredRejectionChecks> = Object.freeze({
  /**
   * Requires the thrown rejection type to appear in the handler declaration.
   *
   * @param methodName Handler method used in a diagnostic.
   * @param schemas Rejection schemas recorded by generated metadata.
   * @param rejection Actual rejection thrown by the handler.
   */
  require(
    methodName: string,
    schemas: readonly DescriptorMessageSchema[],
    rejection: RejectionThrowable,
  ): void {
    if (schemas.some((schema) => schema.typeName === rejection.schema.typeName)) return;
    throw new Error(
      `Handler "${methodName}" threw undeclared rejection "${rejection.schema.typeName}".`,
    );
  },
});
