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

import { type Application } from "@spine-event-engine/server";

const applications = new WeakMap<object, { application: Application; closed: boolean }>();

/**
 * Keeps an Orders Application reachable from its explicit setup during failed startup.
 */
export const OrdersApplicationLifetime: Readonly<{
  track(setup: object, application: Application): void;
  completed(setup: object): void;
  close(setup: object): Promise<boolean>;
}> = Object.freeze({
  /**
   * Records the Application created from a setup handle.
   *
   * @param setup Explicit setup handle.
   * @param application Application using the setup facilities.
   */
  track(setup: object, application: Application): void {
    applications.set(setup, { application, closed: false });
  },

  /**
   * Records successful host cleanup before setup closure.
   *
   * @param setup Explicit setup handle.
   */
  completed(setup: object): void {
    const tracked = applications.get(setup);
    if (tracked !== undefined) tracked.closed = true;
  },

  /**
   * Retries Application cleanup before setup releases its facilities.
   *
   * @param setup Explicit setup handle.
   * @returns Whether the Application released the setup facilities.
   */
  async close(setup: object): Promise<boolean> {
    const tracked = applications.get(setup);
    if (tracked === undefined) return false;
    if (!tracked.closed) await tracked.application.close();
    applications.delete(setup);
    return true;
  },
});
