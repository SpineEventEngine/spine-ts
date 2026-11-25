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
import {
  DeliverySessionHandleSchema,
  type DeliverySessionHandle,
} from "@spine-event-engine/proto/delivery-server";
import { InMemoryDelivery } from "../src/index.js";

type PickupResult = Awaited<
  ReturnType<ReturnType<typeof InMemoryDelivery.create>["managed"]["pickShardRaw"]>
>;

/**
 * Requires a successful pickup and materializes its typed wire handle.
 *
 * @param result Supplies the typed session service result.
 * @returns The granted session handle.
 */
export function pickedHandle(result: PickupResult): DeliverySessionHandle {
  if (result.result?.case !== "pickedUp") throw new Error("Expected a shard pickup.");
  return create(DeliverySessionHandleSchema, result.result.value);
}
