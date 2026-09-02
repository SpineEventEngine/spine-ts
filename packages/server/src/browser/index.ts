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

import { browserServerImplementation } from "./browser-server.js";

/**
 * Composes an admitted browser gateway around a loopback native server, or
 * runs a standalone gateway forwarding to declared backends or discovery.
 */
export const BrowserServer: Readonly<{
  open: typeof browserServerImplementation.open;
  run: typeof browserServerImplementation.run;
}> = Object.freeze({
  open: browserServerImplementation.open,
  run: browserServerImplementation.run,
});
export {
  DurableSubscriptionBindings,
  isDurableSubscriptionBindings,
  type DurableSubscriptionBindingsOptions,
} from "./durable-subscription-bindings.js";
export type {
  BrowserAdmission,
  BrowserAuthRoute,
  BrowserBackend,
  BrowserServerCollaborators,
  BrowserServerOptions,
  StandaloneBrowserServerOptions,
} from "./options.js";
