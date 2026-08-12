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
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import {
  Health,
  HealthCheckResponse_ServingStatus as ServingStatus,
} from "@spine-event-engine/proto/delivery-server";

const known = new Set([
  "",
  "grpc.health.v1.Health",
  "spine.delivery.InboxService",
  "spine.delivery.ShardService",
  "spine.delivery.AdminService",
]);

/**
 * Provides Delivery health handler implementations.
 */
export const HealthHandlers: Readonly<{
  create(serving: () => boolean): ServiceImpl<typeof Health>;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Creates health handlers.
   *
   * @param serving Reports whether the server accepts traffic.
   * @returns Provides Connect health handlers.
   */
  create(serving: () => boolean): ServiceImpl<typeof Health> {
    return {
      check: (request) => ({
        status:
          serving() && known.has(request.service)
            ? ServingStatus.SERVING
            : ServingStatus.NOT_SERVING,
      }),
      watch: () => {
        throw new ConnectError("Delivery health watch is not implemented.", Code.Unimplemented);
      },
    };
  },
});
