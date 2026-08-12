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
 * Describes the ordered resources closed during delivery-server shutdown.
 */
export interface DeliveryServerShutdownResources {
  // prettier-ignore

  /**
   * Sets Health to no longer serving.
   */
  readonly markNotServing: () => void;

  /**
   * Closes the shared mutation-admission boundary.
   */
  readonly closeAdmission: () => void;

  /**
   * Closes Admin subscribers and publishing.
   */
  readonly closeAdmin: () => void;

  /**
   * Closes the listener and active HTTP/2 sessions.
   *
   * @returns Completes after the listener closes.
   */
  readonly closeNetwork: () => Promise<void>;
}

/**
 * Provides the delivery-server terminal shutdown sequence.
 */
export const DeliveryShutdown: Readonly<{
  // prettier-ignore

  /**
   * Runs the required Health, admission, Admin, listener, and session shutdown order.
   *
   * @param resources Holds the shutdown resources in their required phases.
   * @returns A promise that resolves after network shutdown completes.
   */
  run: (resources: DeliveryServerShutdownResources) => Promise<void>;
}> = Object.freeze({
  run: async (resources: DeliveryServerShutdownResources): Promise<void> => {
    resources.markNotServing();
    resources.closeAdmission();
    resources.closeAdmin();
    await resources.closeNetwork();
  },
});
