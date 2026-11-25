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

import {
  DeliveryBuilder as LocalBuilder,
  type LocalDeliveryConfig,
  type LocalDeliveryFacility,
} from "@spine-event-engine/server";

import { RemoteDelivery, type RemoteDeliveryConfig } from "./remote-delivery.js";

/**
 * Configures one application-wide local or remote delivery facility.
 */
export const DeliveryBuilder: Readonly<{
  remote(config: RemoteDeliveryConfig): RemoteDelivery;
  local(config: LocalDeliveryConfig): LocalDeliveryFacility;
}> = Object.freeze({
  /**
   * Connects an application environment to a delivery endpoint.
   *
   * @param config Selects the endpoint and work notification mode.
   * @returns An unopened facility installable in a server environment.
   */
  remote(config: RemoteDeliveryConfig): RemoteDelivery {
    return RemoteDelivery.connectTo(config);
  },

  /**
   * Creates shared application storage ports with a custom persisted-row observer.
   *
   * @param config Selects storage and the observer that initiates delivery.
   * @returns A facility installable in a server environment.
   */
  local(config: LocalDeliveryConfig): LocalDeliveryFacility {
    return LocalBuilder.local(config);
  },
});
