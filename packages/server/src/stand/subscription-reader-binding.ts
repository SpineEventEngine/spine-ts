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

import { create } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import type { ReaderIdentity } from "@spine-event-engine/core/spi/trusted-reader";
import {
  SubscriptionReaderBindingSchema,
  type SubscriptionReaderBinding,
} from "@spine-event-engine/proto/client";

/**
 * Converts stable verified reader IDs to the maintained subscription record field.
 */
export const SubscriptionReaderBindings: Readonly<{
  /**
   * Decodes a persisted binding without treating an absent legacy field as anonymous.
   *
   * @param binding Stored reader field, or undefined for a legacy record.
   * @returns Stable reader identity, or undefined when no binding was stored.
   */ read(binding: SubscriptionReaderBinding | undefined): ReaderIdentity | undefined;

  /**
   * Encodes the stable reader identity in the maintained record field.
   *
   * @param reader Verified reader identity, or undefined for a legacy record.
   * @returns Binding field when a stable identity is present.
   */ write(reader: ReaderIdentity | undefined): SubscriptionReaderBinding | undefined;
}> = Object.freeze({
  /**
   * Reads one bound identity while leaving older records explicitly unbound.
   *
   * @param binding Stored reader field, possibly absent on a legacy record.
   * @returns Stable identity or undefined only when the field is absent.
   */
  read(binding: SubscriptionReaderBinding | undefined): ReaderIdentity | undefined {
    if (binding === undefined) return undefined;
    if (binding.identity.case === "principalId" && binding.identity.value.trim())
      return Object.freeze({ kind: "principal", id: binding.identity.value });
    if (binding.identity.case === "anonymous") return Object.freeze({ kind: "anonymous" });
    throw new Error("Subscription reader binding is invalid.");
  },

  /**
   * Writes one stable identity without storing authority facts or credentials.
   *
   * @param reader Verified reader identity, or undefined for an old unbound record.
   * @returns Maintained Proto binding field when present.
   */
  write(reader: ReaderIdentity | undefined): SubscriptionReaderBinding | undefined {
    if (reader === undefined) return undefined;
    if (reader.kind === "anonymous")
      return create(SubscriptionReaderBindingSchema, {
        identity: { case: "anonymous", value: create(EmptySchema) },
      });
    if (!reader.id.trim()) throw new Error("Subscription reader principal ID is invalid.");
    return create(SubscriptionReaderBindingSchema, {
      identity: { case: "principalId", value: reader.id },
    });
  },
});
