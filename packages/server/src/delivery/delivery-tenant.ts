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

import { clone } from "@bufbuild/protobuf";
import { AnyPacker } from "@spine-event-engine/core";
import {
  CommandSchema,
  EventSchema,
  TenantIdSchema,
  type TenantId,
} from "@spine-event-engine/proto";
import { TenantBoundary } from "@spine-event-engine/storage/provider";

import type { InboxMessage } from "./inbox.js";

/**
 * Reads the captured tenant from the actual durable Command or Event envelope.
 *
 * @param message Durable Inbox row with its original packed signal.
 * @returns Detached tenant ID, or the neutral single-tenant scope.
 */
export function deliveryTenant(message: InboxMessage): TenantId | undefined {
  if (message.signal === undefined) throw new Error("Inbox signal is missing.");
  let tenantId: TenantId | undefined;
  if (message.label === "HANDLE_COMMAND") {
    tenantId = AnyPacker.unpack(message.signal, CommandSchema).context?.actorContext?.tenantId;
  } else {
    const origin = AnyPacker.unpack(message.signal, EventSchema).context?.origin;
    if (origin?.case === "importContext") tenantId = origin.value.tenantId;
    if (origin?.case === "pastMessage") tenantId = origin.value.actorContext?.tenantId;
  }
  return tenantId === undefined ? undefined : clone(TenantIdSchema, tenantId);
}

/**
 * Returns the complete canonical tenant boundary for a durable Inbox row.
 *
 * @param message Durable row carrying its original signal.
 * @returns Stable tenant key, including the neutral single-tenant boundary.
 */
export function deliveryTenantKey(message: InboxMessage): string {
  const tenantId = deliveryTenant(message);
  return String(
    tenantId === undefined ? TenantBoundary.single.key : TenantBoundary.from(tenantId).key,
  );
}
