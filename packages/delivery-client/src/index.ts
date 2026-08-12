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

/**
 * Public facade for the Node delivery-server client.
 */
export {
  DeliveryClient,
  DeliveryOutcomeUnknownError,
  DeliveryPagingError,
  DeliveryProtocolError,
  DeliveryShardObservationError,
  ShardObservationOverflowError,
  MAX_DELIVERY_BATCH_MESSAGES,
  MAX_DELIVERY_RPC_BYTES,
  MAX_INBOX_PAYLOAD_BYTES,
} from "./client/client.js";
export { RemoteInbox, RemoteWorkRegistry } from "./remote/adapters.js";
export { RemoteDelivery, type RemoteDeliveryConfig } from "./remote/remote-delivery.js";

export type {
  DeliveryClientOptions,
  DeliveryFindOneOptions,
  DeliveryMutationOptions,
  DeliveryReadPageOptions,
  DeliveryShardObservationStream,
  DeliveryWorkerId,
  ReleasedShardSession,
  RemoteShardObservation,
  RemoteShardSession,
} from "./client/client.js";
