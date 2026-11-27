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
 * Exports the retention calculation used by application inbox storage.
 */
export { InboxRetention } from "../delivery/inbox-retention.js";

/**
 * Opens framework delivery facility ports through their internal symbol.
 * @internal
 */
export { deliveryPortAccess } from "../delivery/delivery-port-access.js";

/**
 * Describes a framework-provided message before an Inbox assigns its identity.
 * @internal
 */
export type { InboxMessageInput } from "../delivery/inbox.js";
