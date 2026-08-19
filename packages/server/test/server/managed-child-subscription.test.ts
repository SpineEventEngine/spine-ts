/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { afterEach, expect, it } from "vitest";

import { managedChildSubscriptionAccess } from "../../src/server/managed-child-subscription.js";

afterEach(() => {
  managedChildSubscriptionAccess.clear();
});

it("reports the exact locally installed child subscription once to the managed child hook", () => {
  const installed: string[] = [];
  managedChildSubscriptionAccess.install((id) => installed.push(id));

  managedChildSubscriptionAccess.installed("s-client/0-incarnation");
  managedChildSubscriptionAccess.installed("s-client/0-incarnation");

  expect(installed).toEqual(["s-client/0-incarnation"]);
});

it("does not retain the managed hook after child teardown", () => {
  const installed: string[] = [];
  managedChildSubscriptionAccess.install((id) => installed.push(id));
  managedChildSubscriptionAccess.clear();

  managedChildSubscriptionAccess.installed("s-client/0-incarnation");

  expect(installed).toEqual([]);
});
